import AsyncStorage from '@react-native-async-storage/async-storage'

// ── API 基址多域名自动切换(2026-08-02)────────────────────────────────────────
// 背景:lanwealth.com 的 TLS SNI 在大陆部分线路被注入式 RST 阻断(实测石锤)。
// 候选 = 上次可用域(缓存)→ 服务端下发列表(/api/app-config)→ 种子常量,逐个探测
// /api/app-config 首个 2xx 即选定(轻量+CDN 缓存;勿用 /api/health——它会触发服务端
// 对 Atlas/LiteLLM 的实时外呼,重且慢)。备用域名注册后只需扩充 SEED_BASES 或服务端
// 下发(env 驱动),客户端零发版点亮。Supabase 直连域(*.supabase.co)不受阻断,登录不经此层。
export const SEED_BASES = ['https://app.lanwealth.com', 'https://app.bayze.cn']   // 种子:主域 + 备用域(2026-08-02 注册)

const KEY_LAST_GOOD  = 'base_last_good'     // 上次可用基址
const KEY_REMOTE     = 'base_remote_list'   // 服务端下发列表 { domains, fetchedAt }
const PROBE_TIMEOUT  = 4000                 // 单域探测超时(ms)
const REMOTE_TTL_MS  = 6 * 60 * 60 * 1000   // 下发列表拉取节流:6 小时
const FAIL_COOLDOWN  = 10_000               // 全灭后短暂冷却,避免离线时每个请求都白等探测

let currentBase: string | null = null            // 本会话已验证可用的基址
let resolving:   Promise<string> | null = null   // 并发防抖:同一时刻只跑一次探测
let lastAllFailedAt = 0

// 规范化:补 https:// 前缀、去尾斜杠;空值返回 null
function normalize(u: string | null | undefined): string | null {
  const t = (u ?? '').trim()
  if (!t) return null
  return (/^https?:\/\//i.test(t) ? t : `https://${t}`).replace(/\/+$/, '')
}

async function probe(base: string): Promise<boolean> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT)
  try {
    const r = await fetch(`${base}/api/app-config`, { signal: ctrl.signal })
    return r.status >= 200 && r.status < 300
  } catch { return false } finally { clearTimeout(timer) }
}

async function readRemote(): Promise<{ domains: string[]; fetchedAt: number }> {
  try {
    const raw = await AsyncStorage.getItem(KEY_REMOTE)
    const j = raw ? JSON.parse(raw) as { domains?: unknown; fetchedAt?: unknown } : null
    const domains = j && Array.isArray(j.domains) ? (j.domains as unknown[]).filter((d): d is string => typeof d === 'string') : []
    return { domains, fetchedAt: j && typeof j.fetchedAt === 'number' ? j.fetchedAt : 0 }
  } catch { return { domains: [], fetchedAt: 0 } }
}

// 拉取服务端下发的候选域名列表(GET /api/app-config → { domains: string[] });
// 距上次成功拉取 <6 小时不拉,失败静默。resolveBase 成功后异步触发。
export async function refreshRemoteBases(base: string): Promise<void> {
  try {
    const { fetchedAt } = await readRemote()
    if (Date.now() - fetchedAt < REMOTE_TTL_MS) return
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT)
    let r: Response
    try { r = await fetch(`${base}/api/app-config`, { signal: ctrl.signal }) } finally { clearTimeout(timer) }
    if (!r.ok) return
    const j = await r.json().catch(() => null) as { domains?: unknown } | null
    if (!j || !Array.isArray(j.domains)) return
    const domains = (j.domains as unknown[]).map(d => typeof d === 'string' ? normalize(d) : null).filter((d): d is string => !!d)
    await AsyncStorage.setItem(KEY_REMOTE, JSON.stringify({ domains, fetchedAt: Date.now() }))
  } catch { /* 静默 */ }
}

// 解析可用基址。已验证过直接复用(markBaseBad 后才重新全量探测);全部失败保底返回
// last_good ?? SEED_BASES[0],绝不抛异常;并发调用共享同一个 Promise。
export function resolveBase(): Promise<string> {
  if (currentBase) return Promise.resolve(currentBase)
  if (resolving)   return resolving
  resolving = (async () => {
    const [lastGood, remote] = await Promise.all([
      AsyncStorage.getItem(KEY_LAST_GOOD).catch(() => null),
      readRemote(),
    ])
    const fallback = normalize(lastGood) ?? SEED_BASES[0]
    if (Date.now() - lastAllFailedAt < FAIL_COOLDOWN) return fallback   // 刚全灭过,冷却期直接保底
    const candidates = [...new Set(
      [lastGood, ...remote.domains, ...SEED_BASES].map(normalize).filter((u): u is string => !!u),
    )]
    for (const base of candidates) {
      if (await probe(base)) {
        currentBase = base
        void AsyncStorage.setItem(KEY_LAST_GOOD, base).catch(() => undefined)
        void refreshRemoteBases(base)   // 异步刷新下发列表,不阻塞请求
        return base
      }
    }
    lastAllFailedAt = Date.now()
    return fallback
  })().finally(() => { resolving = null })
  return resolving
}

// 标记当前基址失效:清缓存,下次 resolveBase 重新全量探测
export async function markBaseBad(): Promise<void> {
  currentBase = null
  lastAllFailedAt = 0
  await AsyncStorage.removeItem(KEY_LAST_GOOD).catch(() => undefined)
}

// 同步取当前已解析基址(未解析过返回种子首项),供不能 await 的场合(如展示性链接)
export function getBase(): string {
  return currentBase ?? SEED_BASES[0]
}
