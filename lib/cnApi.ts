// ============================================================================
// 大陆版 cn 分支 · 数据层(替代 lib/supabase.ts + lib/api.ts 的国际版链路)
//   后端 = app.lanwealth.cn 境内 FC(cn-chat 对话/OTP,cn-api 数据),数据全境内。
//   v1 口径(与设计方案一致):手机号 OTP 登录 + 非流式对话 + 用量;SSE/岗位人设
//   服务端已支持,客户端后续版本再接(服务端按岗位自动注入,与客户端无关)。
// ============================================================================
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const CN_BASE = 'https://app.lanwealth.cn'   // /api(cn-chat)与 /crm-api(cn-api)同域

// ── 会话令牌(HMAC session_token,与网页端同一张令牌;30 天记住登录由 remember 控制)──
const TOKEN_KEY = 'cn_session_token'
const PHONE_KEY = 'cn_session_phone'

async function kvGet(key: string): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(key)
  try { return await AsyncStorage.getItem(key) } catch { return null }
}
async function kvSet(key: string, value: string): Promise<void> {
  if (Platform.OS !== 'web') return SecureStore.setItemAsync(key, value)
  try { await AsyncStorage.setItem(key, value) } catch {}
}
async function kvDel(key: string): Promise<void> {
  if (Platform.OS !== 'web') return SecureStore.deleteItemAsync(key)
  try { await AsyncStorage.removeItem(key) } catch {}
}

export type CnSession = { token: string; phone: string }

export async function getCnSession(): Promise<CnSession | null> {
  const token = await kvGet(TOKEN_KEY)
  const phone = await kvGet(PHONE_KEY)
  return token && phone ? { token, phone } : null
}
export async function saveCnSession(token: string, phone: string): Promise<void> {
  await kvSet(TOKEN_KEY, token)
  await kvSet(PHONE_KEY, phone)
}
export async function clearCnSession(): Promise<void> {
  await kvDel(TOKEN_KEY)
  await kvDel(PHONE_KEY)
}

// ── 统一请求(JSON POST;20s 超时)──
async function post(path: string, body: Record<string, unknown>, timeoutMs = 20000): Promise<Record<string, any>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${CN_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.error) {
      const err = new Error(j.error || `请求失败(${res.status})`) as Error & { status?: number; quota?: boolean }
      err.status = res.status
      if (j.quota) err.quota = true
      throw err
    }
    return j
  } finally {
    clearTimeout(timer)
  }
}

// ── 登录:手机号验证码(登注合一;与网页端同款)──
export type CnResult = { ok: boolean; error?: string }

export async function cnOtpSend(phone: string): Promise<CnResult> {
  try {
    await post('/api', { action: 'otp_send', phone })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '发送失败' }
  }
}

export async function cnOtpVerify(phone: string, code: string, remember: boolean): Promise<CnResult> {
  try {
    const j = await post('/api', { action: 'otp_verify', phone, code, remember })
    if (!j.session_token) return { ok: false, error: '验证失败,请重试' }
    await saveCnSession(j.session_token, phone)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '验证失败' }
  }
}

export async function cnLogout(): Promise<void> {
  await clearCnSession()
}

// ── 模型目录(与 cn-chat MODELS 同源;写死兜底,后续可换服务端 /api models 下发)──
export const CN_MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', tag: '快速',  free: true  },
  { id: 'deepseek-v4-pro',     name: 'DeepSeek V4 Pro',     tag: '推理',  free: false },
  { id: 'glm-5.3-flash',       name: '智谱 GLM-5.3 Flash',  tag: '快速',  free: false },
  { id: 'doubao-seed-pro',     name: '豆包 Seed 2.1 Pro',   tag: '均衡',  free: false },
  { id: 'kimi-k2.7',           name: 'Kimi K2.7',           tag: '长文',  free: false },
]

export type CnMessage = { role: 'user' | 'assistant' | 'system'; content: string }

// ── 对话(非流式;cn-chat 按活跃企业岗位自动注入人设、按额度闸门)──
export async function cnChat(
  model: string,
  messages: CnMessage[],
  opts?: { secret?: boolean; signal?: AbortSignal },
): Promise<{ content: string; usage?: { prompt?: number; completion?: number; total?: number } }> {
  const session = await getCnSession()
  if (!session) throw Object.assign(new Error('会话已过期,请重新登录'), { status: 401 })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  const onOuterAbort = () => ctrl.abort()
  opts?.signal?.addEventListener('abort', onOuterAbort)
  try {
    const res = await fetch(`${CN_BASE}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'chat', session_token: session.token, model, messages: messages.slice(-20), secret: opts?.secret === true }),
      signal: ctrl.signal,
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.error) {
      throw Object.assign(new Error(j.error || '服务异常'), { status: res.status, quota: !!j.quota })
    }
    return { content: j.content || '(空响应)', usage: j.usage }
  } finally {
    clearTimeout(timer)
    opts?.signal?.removeEventListener('abort', onOuterAbort)
  }
}

// ── 对话(SSE 流式;cn-stream /stream,逐字到达)──────────────────────────────
// RN 的 fetch 不暴露流式 body,用 XHR(RN 下 responseText 增量累积 + onprogress 可靠触发,
// 与国际版 lib/api.ts 同款引擎)。协议:服务端逐条下发 `data: {"delta":"片段"}`,
// 收尾一条 `data: {"done":true,...}`。
let cnActiveXhr: XMLHttpRequest | null = null
let cnUserStopped = false
export const CN_USER_STOP = '__cn_user_stop__'
export function cnStopStream() {
  cnUserStopped = true
  try { cnActiveXhr?.abort() } catch {}
}

export async function* cnStreamChat(model: string, messages: CnMessage[], opts?: { secret?: boolean }): AsyncGenerator<string> {
  const session = await getCnSession()
  if (!session) throw Object.assign(new Error('会话已过期,请重新登录'), { status: 401 })
  if (cnUserStopped) { cnUserStopped = false; throw new Error(CN_USER_STOP) }

  const queue: string[] = []
  let finished = false
  let failed: Error | null = null
  let wake: (() => void) | null = null
  const bump = () => { const w = wake; wake = null; w?.() }

  const xhr = new XMLHttpRequest()
  cnActiveXhr = xhr
  xhr.open('POST', `${CN_BASE}/stream`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  xhr.send(JSON.stringify({ action: 'chat', session_token: session.token, model, messages: messages.slice(-20), secret: opts?.secret === true }))

  // 停滞看门狗:120s 无任何进展视为静默死亡(cn-stream FC 超时 120s;每次进展重置,
  // 不用 xhr.timeout 因为那是总时长上限,会腰斩正常的长生成)
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      failed = failed ?? new Error('连接长时间无响应,已中断')
      try { xhr.abort() } catch {}
      finished = true; bump()
    }, 120_000)
  }
  armStall()

  let seen = 0
  let buf = ''
  const consume = (flush = false) => {
    buf += xhr.responseText.slice(seen)
    seen = xhr.responseText.length
    const lines = buf.split('\n')
    buf = flush ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as { delta?: string; done?: boolean; error?: string }
        if (j.delta) queue.push(j.delta)
        if (j.done && j.error && !queue.length) failed = failed ?? new Error(j.error)
      } catch {}
    }
    bump()
  }
  xhr.onprogress = () => { armStall(); consume() }
  xhr.onload = () => {
    if (stallTimer) clearTimeout(stallTimer)
    if (xhr.status >= 400) {
      let msg = `HTTP ${xhr.status}`
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg } catch {}
      let quota = false
      try { quota = !!(JSON.parse(xhr.responseText) as { quota?: boolean }).quota } catch {}
      failed = failed ?? Object.assign(new Error(msg), { status: xhr.status, quota })
    } else {
      consume(true)
    }
    finished = true; bump()
  }
  xhr.onerror = () => { if (stallTimer) clearTimeout(stallTimer); failed = failed ?? new Error('Network request failed'); finished = true; bump() }
  xhr.onabort = () => {
    if (stallTimer) clearTimeout(stallTimer)
    if (cnUserStopped) failed = failed ?? new Error(CN_USER_STOP)
    finished = true; bump()
  }
  xhr.ontimeout = () => { if (stallTimer) clearTimeout(stallTimer); failed = failed ?? new Error('Network request failed'); finished = true; bump() }

  try {
    while (true) {
      if (queue.length) { yield queue.shift()!; continue }
      if (failed) throw failed
      if (finished) return
      await new Promise<void>((resolve) => { wake = resolve })
    }
  } finally {
    cnActiveXhr = null
    if (stallTimer) clearTimeout(stallTimer)
  }
}

// ── 用量(cn-api usage_account:近 60 天按天按模型)──
export type CnUsage = { day: string; model: string; calls: number; prompt_tokens: number; completion_tokens: number }[]

export async function cnUsage(): Promise<CnUsage> {
  const session = await getCnSession()
  if (!session) throw Object.assign(new Error('未登录'), { status: 401 })
  const j = await post('/crm-api', { action: 'usage_account', session_token: session.token })
  return (j.usage || []) as CnUsage
}

// ── 附件:文档文本提取(base64 直传,PDF/DOCX/TXT;不入文件库,提取结果作对话上下文)──
export async function cnFileExtract(filename: string, contentB64: string): Promise<{ ok: boolean; text?: string; chars?: number; error?: string }> {
  const session = await getCnSession()
  if (!session) return { ok: false, error: '未登录' }
  try {
    const j = await post('/crm-api', { action: 'file_extract', session_token: session.token, filename, content_b64: contentB64 }, 60000)
    return { ok: true, text: j.text as string, chars: j.chars as number }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '提取失败' }
  }
}
