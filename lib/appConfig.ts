import AsyncStorage from '@react-native-async-storage/async-storage'
import { resolveBase } from './baseUrl'

// ── 运行期配置(2026-08-06)──────────────────────────────────────────────────
// 从 /api/app-config 读服务端下发的开关。目前只有一项:手机号验证码登录是否可用。
//
// 为什么走服务端下发而不是打进包里:App Store 审核动辄数天,开关要能**不重新上架**
// 就点亮/关闭。这与 baseUrl.ts 的域名下发是同一思路(那里注释写的「客户端零发版点亮」)。
//
// 缓存策略:结果写 AsyncStorage,下次启动**先用缓存立即渲染**(避免登录页先显示
// 邮箱、几百毫秒后才蹦出手机号 Tab 的跳动),再后台刷新。首次安装无缓存时按**关闭**
// 处理 —— 宁可少一个入口,也不要显示一个点了会报错的按钮。

const KEY = 'app_config_v1'
const TTL_MS = 30 * 60 * 1000        // 后台刷新节流:30 分钟
const TIMEOUT = 4000

// tools:「Tools」实用工具 Tab 是否显示。与 phoneAuth 相反,它**默认开**——该 Tab 只是打开
// 网页版工具的入口,恒安全;仅当服务端显式下发 tools:false(MOBILE_TOOLS_TAB=0)才隐藏。
export type AppConfig = { phoneAuth: boolean; tools: boolean }
const DEFAULT: AppConfig = { phoneAuth: false, tools: true }

type Cached = { cfg: AppConfig; fetchedAt: number }

async function readCache(): Promise<Cached | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as { cfg?: unknown; fetchedAt?: unknown }
    const c = j?.cfg as Record<string, unknown> | undefined
    if (!c) return null
    return {
      cfg: { phoneAuth: c.phoneAuth === true, tools: c.tools !== false },
      fetchedAt: typeof j.fetchedAt === 'number' ? j.fetchedAt : 0,
    }
  } catch { return null }
}

/** 立即可用的配置:有缓存用缓存,没有就用默认(全关)。不发网络请求。 */
export async function getCachedConfig(): Promise<AppConfig> {
  return (await readCache())?.cfg ?? DEFAULT
}

/**
 * 拉一次服务端配置并写缓存。失败静默返回 null(保持上次值)——
 * 配置拉不到不该影响登录:邮箱登录本来就不依赖它。
 */
export async function refreshConfig(): Promise<AppConfig | null> {
  try {
    const cached = await readCache()
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.cfg

    const base = await resolveBase()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
    let r: Response
    try { r = await fetch(`${base}/api/app-config`, { signal: ctrl.signal }) }
    finally { clearTimeout(timer) }
    if (!r.ok) return null

    const j = await r.json().catch(() => null) as Record<string, unknown> | null
    if (!j) return null
    // phoneAuth:老服务端不下发 → undefined → 按关闭(不会误开)。
    // tools:反向,老服务端不下发 → 显示(默认开);仅显式 false 才隐藏。
    const cfg: AppConfig = { phoneAuth: j.phoneAuth === true, tools: j.tools !== false }
    await AsyncStorage.setItem(KEY, JSON.stringify({ cfg, fetchedAt: Date.now() })).catch(() => undefined)
    return cfg
  } catch { return null }
}
