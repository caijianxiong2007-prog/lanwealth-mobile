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

// ── 401 统一登出(P1-08,2026-10-15):令牌过期/撤销 → 原子清会话 + 单次跳登录 ──
// 多个在途请求同时 401 时只清理+跳转一次(handling401 单飞);1.5s 后复位,
// 允许下一次会话过期再次触发。handler 由根布局注册(router.replace),lib 层不引导航。
let unauthorizedHandler: (() => void) | null = null
let handling401 = false
export function setCnUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}
export function unauthorizedMessage(): string {
  return '登录已过期,请重新登录'
}
async function on401(): Promise<void> {
  if (handling401) return
  handling401 = true
  try {
    await clearCnSession()
    if (unauthorizedHandler) { try { unauthorizedHandler() } catch {} }
  } finally {
    setTimeout(() => { handling401 = false }, 1500)
  }
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
    if (res.status === 401) {
      // P1-08:统一 401——清会话+跳登录后再抛,调用方按普通错误提示即可
      await on401()
      const err = new Error(unauthorizedMessage()) as Error & { status?: number; unauthorized?: boolean }
      err.status = 401
      err.unauthorized = true
      throw err
    }
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

// ── 图片文字识别(拍照/相册 → qwen-vl-ocr → 文本;2 点/次,失败不扣)──
export async function cnOcr(image: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const session = await getCnSession()
  if (!session) return { ok: false, error: '会话已过期,请重新登录' }
  try {
    const res = await fetch(`${CN_BASE}/api`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ocr', session_token: session.token, image }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.status === 401) { await on401(); return { ok: false, error: unauthorizedMessage() } }
    if (!res.ok || j.error) return { ok: false, error: j.error || '识别失败' }
    return { ok: true, text: j.text || '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络异常' }
  }
}

// ── 账号注销申请(App 内发起,Apple 5.1.1(v) 要求;顾问电话核实后执行,与网页端同款)──
export async function cnAccountDelete(): Promise<{ ok: boolean; dedup?: boolean; error?: string }> {
  try {
    const session = await getCnSession()
    if (!session) return { ok: false, error: '会话已过期,请重新登录' }
    const j = await post('/crm-api', { action: 'account_delete_request', session_token: session.token })
    return { ok: !!j.ok, dedup: !!j.dedup }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '提交失败' }
  }
}

// ── 登录:手机号验证码(登注合一;与网页端同款)──
export type CnResult = { ok: boolean; error?: string }

// consent(P0-02):登录页协议同意留痕,随发码请求上送,服务端写 account_consents
export async function cnOtpSend(phone: string, consent?: { version: string; channel?: string; device?: string }): Promise<CnResult> {
  try {
    await post('/api', { action: 'otp_send', phone, ...(consent ? { consent } : {}) })
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
// bayze-auto=Bayze 智选(瀑布式):服务端按问题类别选专家模型(Kimi/GLM/豆包)做专长分析,
// 再由 DeepSeek V4 Pro 独立核对合成终稿——与网页端 chat.html 同一通道(cn-chat/cn-stream 已支持)。
export const CN_MODELS = [
  { id: 'bayze-auto',          name: 'Bayze 智选',           tag: '专家分析+高阶综合', free: false },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', tag: '快速',  free: true  },
  { id: 'deepseek-v4-pro',     name: 'DeepSeek V4 Pro',     tag: '推理',  free: false },
  { id: 'glm-5.3-flash',       name: '智谱 GLM-5.3 Flash',  tag: '快速',  free: false },
  { id: 'doubao-seed-pro',     name: '豆包 Seed 2.1 Pro',   tag: '均衡',  free: false },
  { id: 'kimi-k2.7',           name: 'Kimi K2.7',           tag: '长文',  free: false },
  { id: 'qwen-vl-max',         name: '千问 VL Max',         tag: '看图',  free: false },
]

// content 支持多模态数组(带图提问: [{type:'text'},{type:'image_url',image_url:{url:'data:...'}}])
export type CnMessage = { role: 'user' | 'assistant' | 'system'; content: string | Array<Record<string, unknown>> }

// ── 对话(非流式;cn-chat 按活跃企业岗位自动注入人设、按额度闸门)──
export async function cnChat(
  model: string,
  messages: CnMessage[],
  opts?: { secret?: boolean; signal?: AbortSignal },
): Promise<{ content: string; usage?: { prompt?: number; completion?: number; total?: number } }> {
  const session = await getCnSession()
  if (!session) throw Object.assign(new Error('会话已过期,请重新登录'), { status: 401 })
  const ctrl = new AbortController()
  // 瀑布式(智选)双跳:服务端专家 25s + 终审 30s,非流式兜底放宽到 110s,普通模型维持 60s
  const timer = setTimeout(() => ctrl.abort(), model === 'bayze-auto' ? 110_000 : 60_000)
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

// ── 套餐与额度(plan_info:与网页「我的套餐」同源)──
export type CnPlan = {
  plan: string; label: string; limit: number; scope: 'day' | 'month'
  used: number; remaining: number; expires: string | null
}
export async function cnPlanInfo(): Promise<CnPlan | null> {
  const session = await getCnSession()
  if (!session) return null
  try {
    const j = await post('/crm-api', { action: 'plan_info', session_token: session.token })
    if (!j.ok) return null
    return { plan: j.plan, label: j.label, limit: j.limit, scope: j.scope, used: j.used, remaining: j.remaining, expires: j.expires ?? null }
  } catch { return null }
}

// ── 会话云同步(2026-10-07):同账号手机/网页普通对话互通 ──
// 与网页端同款三动作;失败一律静默(本地仓始终可用,同步是尽力而为)。
export type CnCloudConv = { conv_id: string; title: string; model: string | null; messages: { role: 'user' | 'assistant'; content: string }[]; updated_at: number }

export async function cnConvList(): Promise<CnCloudConv[]> {
  const session = await getCnSession()
  if (!session) return []
  try {
    const j = await post('/crm-api', { action: 'conv_list', session_token: session.token }, 20000)
    if (j.ok !== true || !Array.isArray(j.conversations)) return []
    return j.conversations as CnCloudConv[]
  } catch { return [] }
}

export async function cnConvUpsert(conv: { id: string; title: string; model?: string; messages: { role: string; content: string }[]; updatedAt: number }): Promise<void> {
  const session = await getCnSession()
  if (!session) return
  try {
    await post('/crm-api', {
      action: 'conv_upsert', session_token: session.token,
      conv_id: conv.id.slice(0, 64), title: conv.title.slice(0, 120),
      model: (conv.model || '').slice(0, 40) || undefined,
      messages: conv.messages.filter(m => typeof m.content === 'string').slice(-200),
      updated_at: conv.updatedAt,
    })
  } catch { /* 静默 */ }
}

export async function cnConvDelete(convId: string): Promise<void> {
  const session = await getCnSession()
  if (!session) return
  try { await post('/crm-api', { action: 'conv_delete', session_token: session.token, conv_id: convId.slice(0, 64) }) } catch { /* 静默 */ }
}

// ── 辅助办公检索(与网页 RAG 同源:知识库+客户记忆,0.45 阈值,top3)──
export type CnRagHit =
  | { src: 'kb'; title: string; content: string; score: number }
  | { src: 'mem'; company: string; contact: string | null; facts: string; score: number }

export async function cnRagSearch(q: string): Promise<CnRagHit[]> {
  if (!q || q.length < 4) return []
  const session = await getCnSession()
  if (!session) return []
  const search = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const j = await post('/crm-api', { action, session_token: session.token, q, ...extra })
      if (j.ok !== true || !Array.isArray(j.items)) return []
      return (j.items as Array<Record<string, any>>).filter(it => Number(it.score) >= 0.45)
    } catch { return [] }
  }
  const [kb, mem] = await Promise.all([search('knowledge_search'), search('memory_search')])
  const kbHits: CnRagHit[] = kb.filter(it => it.content).slice(0, 3)
    .map(it => ({ src: 'kb', title: String(it.title || ''), content: String(it.content || ''), score: Number(it.score) }))
  const memHits: CnRagHit[] = mem.filter(it => it.facts).slice(0, 3)
    .map(it => ({ src: 'mem', company: String(it.company || ''), contact: it.contact ?? null, facts: String(it.facts || ''), score: Number(it.score) }))
  return [...kbHits, ...memHits]
}

export function cnRagContext(hits: CnRagHit[]): string | null {
  const kb = hits.filter(h => h.src === 'kb')
  const mem = hits.filter(h => h.src === 'mem')
  if (!kb.length && !mem.length) return null
  const parts: string[] = []
  if (kb.length) parts.push('以下是用户知识库中与提问语义相关的参考内容(若与提问无关请忽略,回答时不要提及"知识库"):\n\n' +
    kb.map(h => '【' + h.title + '】\n' + h.content.slice(0, 400)).join('\n\n'))
  if (mem.length) parts.push('以下是用户客户记忆中与提问语义相关的客户资料(若与提问无关请忽略,回答时不要提及"客户记忆"):\n\n' +
    mem.map(h => '【客户:' + h.company + (h.contact ? ' · ' + h.contact : '') + '】\n' + h.facts.slice(0, 500)).join('\n\n'))
  return parts.join('\n\n')
}

// ═══ 工作台(P2-01 一期,2026-10-19):复用网页版既有动作,移动端轻封装 ═══
// 上下文:finCtx 缺省取账号 active_tenant,无需显式传企业 ID;
// 权限由服务端 hasPerm/scmGuard 逐动作校验,无权返回 403 由调用方呈现。

export type CnWorkSetup = { tenant_id: number; perms: string[] }
export type CnTodo = { id: number; title: string; source_type: string; source_id: number; detail?: { amount?: string } }
export type CnExpense = { id: number; doc_no: string; category: string; amount: string; vendor?: string; description?: string; status: string }
export type CnOrder = { id: number; po_no?: string; so_no?: string; supplier?: string; customer?: string; commodity?: string; amount?: string; status: string; created_at?: string }

async function workPost(body: Record<string, unknown>) {
  const session = await getCnSession()
  if (!session) throw Object.assign(new Error('未登录'), { status: 401 })
  return post('/crm-api', { session_token: session.token, ...body })
}

export async function cnWorkSetup(): Promise<CnWorkSetup> {
  const j = await workPost({ action: 'fin_setup_get' })
  if (!j.ok) throw new Error(j.error || '未开通企业')
  return { tenant_id: j.tenant_id, perms: j.perms || [] }
}
export async function cnTodoList(): Promise<CnTodo[]> {
  const j = await workPost({ action: 'biz_todo_list' })
  return (j.items || []) as CnTodo[]
}
export async function cnTodoDone(id: number): Promise<void> { await workPost({ action: 'biz_todo_done', id }) }
export async function cnExpenseDecide(id: number, decision: 'approved' | 'rejected'): Promise<{ ok: boolean; error?: string }> {
  try {
    const j = await workPost({ action: 'fin_expense_decide', id, decision, extra: {} })
    return { ok: !!j.ok, error: j.error }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : '失败' } }
}
export async function cnExpenseCreate(category: string, amount: string, vendor: string, description: string): Promise<{ ok: boolean; doc_no?: string; error?: string }> {
  try {
    const j = await workPost({ action: 'fin_expense_create', category, amount, vendor, description })
    if (!j.ok) return { ok: false, error: j.error }
    if (j.id) {
      const s = await workPost({ action: 'fin_expense_submit', id: j.id })
      if (!s.ok) return { ok: true, doc_no: j.doc_no, error: '已保存为草稿(提交审批失败:' + (s.error || '') + ')' }
    }
    return { ok: true, doc_no: j.doc_no }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : '失败' } }
}
export async function cnExpenseMine(): Promise<CnExpense[]> {
  const j = await workPost({ action: 'fin_expense_list', mine: true })
  return (j.items || []) as CnExpense[]
}
export async function cnOrders(kind: 'po' | 'so'): Promise<CnOrder[]> {
  const j = await workPost({ action: kind === 'po' ? 'scm_po_list' : 'scm_so_list' })
  return (j.items || []) as CnOrder[]
}
export async function cnKbSearch(q: string, tenantId?: number): Promise<{ title: string; snippet: string }[]> {
  const j = await workPost({ action: 'knowledge_search', q, ...(tenantId ? { scope: 'tenant', tenant_id: tenantId } : {}) })
  return (j.items || []).slice(0, 8).map((it: { title?: string; content?: string }) => ({ title: it.title || '(无标题)', snippet: (it.content || '').slice(0, 120) }))
}

// ── 套餐四态(P2-02):区分 加载中/正常/未开通/加载失败,替代"吞错当体验版" ──
export type CnPlanState =
  | { state: 'loading' }
  | { state: 'ok'; data: CnPlan }
  | { state: 'none' }        // 服务端确认无套餐(个人体验版口径)
  | { state: 'error'; error: string }
export async function cnPlanInfoEx(): Promise<CnPlanState> {
  const session = await getCnSession()
  if (!session) return { state: 'none' }
  try {
    const j = await post('/crm-api', { action: 'plan_info', session_token: session.token })
    if (!j.ok) return { state: 'none' }
    return { state: 'ok', data: { plan: j.plan, label: j.label, limit: j.limit, scope: j.scope, used: j.used, remaining: j.remaining, expires: j.expires ?? null } }
  } catch (e) {
    return { state: 'error', error: e instanceof Error ? e.message : '网络异常' }
  }
}
