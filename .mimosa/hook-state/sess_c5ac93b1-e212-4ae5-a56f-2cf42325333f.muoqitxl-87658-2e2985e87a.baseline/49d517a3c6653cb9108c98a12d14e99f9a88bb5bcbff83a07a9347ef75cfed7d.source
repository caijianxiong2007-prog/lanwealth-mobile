import { resolveBase, markBaseBad, getBase } from './baseUrl'

/** @deprecated 仅用于展示性链接兜底;请求路径一律走 resolveBase()/apiFetch(多域名自动切换),展示链接优先 getBase() */
export const APP_URL = 'https://app.lanwealth.com'

// 网络层错误(连接被 RST/超时/中断),区别于 HTTP 状态错误 → 换域重试的依据
function isNetworkError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /Network request failed|aborted/i.test(e.message))
}

// 黑洞式丢包(无 RST)下也能触发换域,而非挂到系统默认超时
const REQUEST_TIMEOUT = 20_000

// 调用方未自带 signal 时补默认超时;自带则完全尊重调用方(自管取消/超时)
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  if (init?.signal) return fetch(url, init)
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) }
  finally { clearTimeout(timer) }
}

// 统一平台 API fetch:多域名解析拼 URL;网络层错误 markBaseBad 后换新域重试一次(仅一次)。
// 注意:重试会重发请求——非幂等 POST 在「请求已达服务端但响应前断线」窗口有重复执行可能,
// 属容灾取舍(SNI 阻断都发生在 TLS 握手期,安全)。
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await resolveBase()
  try {
    return await fetchWithTimeout(`${base}${path}`, init)
  } catch (err) {
    if (init?.signal?.aborted) throw err       // 调用方主动取消,不算域故障、不重试
    if (!isNetworkError(err)) throw err
    await markBaseBad()
    const next = await resolveBase()
    return fetchWithTimeout(`${next}${path}`, init)
  }
}

export { resolveBase, getBase }

// Mirrors the web ChatClient working set (ids must match gateway aliases on app.lanwealth.com).
// 2026-07-29 换代(随 1.3.2 发版):Sonnet 5 / GPT-5.6 Terra+Sol / Gemini 3.5-flash-lite /
// Qwen3.5 系;旧 ID(sonnet-4-6/gpt-5.4/gemini-2.5-flash/qwen-turbo/qwen3-235b)网关仍兼容,
// 旧版 App 不受影响。GLM-4.7 via 火山方舟。
export const MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tag: 'Fast',      group: 'DeepSeek',  free: true,  vision: false },
  { id: 'deepseek-v4-pro',   name: 'DeepSeek V4 Pro',   tag: 'Reasoning', group: 'DeepSeek',  free: false, vision: false },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', tag: 'Fast', group: 'Google', free: true,  vision: true  },
  { id: 'gemini-3.6-flash',  name: 'Gemini 3.6 Flash',  tag: 'Advanced',  group: 'Google',    free: false, vision: true  },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  tag: 'Fast',      group: 'Claude',    free: false, vision: true  },
  { id: 'claude-sonnet-5',   name: 'Claude Sonnet 5',   tag: 'Balanced',  group: 'Claude',    free: false, vision: true  },
  { id: 'claude-opus-5',     name: 'Claude Opus 5',     tag: 'Advanced',  group: 'Claude',    free: false, vision: true  },
  { id: 'gpt-5.4-mini',      name: 'GPT-5.4 mini',      tag: 'Fast',      group: 'OpenAI',    free: false, vision: true  },
  { id: 'gpt-5.6-terra',     name: 'GPT-5.6 Terra',     tag: 'Balanced',  group: 'OpenAI',    free: false, vision: true  },
  { id: 'gpt-5.6-sol',       name: 'GPT-5.6 Sol',       tag: 'Advanced',  group: 'OpenAI',    free: false, vision: true  },
  { id: 'doubao-seed-lite',  name: 'Doubao 2.0 Mini',   tag: 'Fast',      group: 'ByteDance', free: false, vision: false },
  { id: 'doubao-seed-pro',   name: 'Doubao 2.1 Turbo',  tag: 'Balanced',  group: 'ByteDance', free: false, vision: false },
  { id: 'doubao-seed-2.1-pro', name: 'Doubao 2.1 Pro',  tag: 'Advanced',  group: 'ByteDance', free: false, vision: false },
  { id: 'qwen3.5-flash',     name: 'Qwen3.5 Flash',     tag: 'Fast',      group: 'Qwen',      free: true,  vision: false },
  { id: 'qwen-plus',         name: 'Qwen Plus',         tag: 'Balanced',  group: 'Qwen',      free: false, vision: false },
  { id: 'qwen3.5-plus',      name: 'Qwen3.5 Plus',      tag: 'Advanced',  group: 'Qwen',      free: false, vision: false },
  { id: 'glm-5.2',           name: 'GLM-5.2',           tag: 'Advanced',  group: 'Zhipu',     free: false, vision: false },
]

// Languages the AI can respond in (via system prompt injection)
export const CHAT_LANGS = [
  { code: '',   label: 'Auto',        native: 'Auto'           },
  { code: 'en', label: 'English',     native: 'English'        },
  { code: 'zh', label: 'Chinese',     native: '中文'            },
  { code: 'ja', label: 'Japanese',    native: '日本語'          },
  { code: 'ko', label: 'Korean',      native: '한국어'          },
  { code: 'vi', label: 'Vietnamese',  native: 'Tiếng Việt'     },
  { code: 'th', label: 'Thai',        native: 'ภาษาไทย'        },
  { code: 'ms', label: 'Malay',       native: 'Bahasa Melayu'  },
  { code: 'id', label: 'Indonesian',  native: 'Bahasa Indonesia'},
  { code: 'es', label: 'Spanish',     native: 'Español'        },
  { code: 'fr', label: 'French',      native: 'Français'       },
  { code: 'ar', label: 'Arabic',      native: 'العربية'        },
]

// Multimodal message content (OpenAI-compatible), mirrors the web ChatClient format.
export type ContentPart =
  | { type: 'text';      text: string }
  | { type: 'image_url'; image_url: { url: string } }   // url = data:image/...;base64,...

export type Message = { role: 'user' | 'assistant' | 'system'; content: string | ContentPart[] }

// Flatten a message's content to plain text (for titles, export, previews).
export function messageText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n')
}

export function contentImages(content: string | ContentPart[]): string[] {
  if (typeof content === 'string') return []
  return content.filter(p => p.type === 'image_url').map(p => (p as { image_url: { url: string } }).image_url.url)
}

interface ChatOptions {
  accessToken:   string
  model:         string
  messages:      Message[]
  responseLang?: string   // ISO code — prepended as system prompt
  customApiUrl?: string   // OpenAI-compatible base URL (BYOK)
  customApiKey?: string   // API key for custom endpoint
  scope?:        'company' | 'personal'   // 公司/个人双模式(服务端在企业+政策允许时生效,个人=双向隔离)
  customerId?:   string                   // 关联客户 — 服务端注入该客户档案+记忆(过客户 ACL)
}

// ── 停止生成(2026-08-18 事故整改):XHR 挂在模块级,发送键流式中变停止按钮时调用。
//    userStopped 让 send() 把中止与真错误区分开 —— 用户主动停要保留已生成的部分正文。
let activeXhr: XMLHttpRequest | null = null
let userStopped = false
export const USER_STOP = '__user_stop__'
const STALL_MSG = '连接长时间无响应,已中断。请重试。'
export function stopStream() {
  userStopped = true
  try { activeXhr?.abort() } catch {}
}

export async function* streamChat(opts: ChatOptions): AsyncGenerator<string> {
  userStopped = false   // 每次新流复位一次;attempt() 内不再复位(换域重试须尊重窗口内的停止)
  const { accessToken, model, messages, responseLang, customApiUrl, customApiKey, scope, customerId } = opts

  // Prepend system language instruction if set
  const allMessages: Message[] = []
  if (responseLang) {
    const langNative = CHAT_LANGS.find(l => l.code === responseLang)?.native ?? responseLang
    allMessages.push({ role: 'system', content: `Please respond in ${langNative}.` })
  }
  allMessages.push(...messages)

  const useCustom = !!(customApiUrl && customApiKey)

  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${useCustom ? customApiKey : accessToken}`,
    // 服务端据此下发「手机端导出引导」persona(无每条回复导出按钮);老版本无此头时
    // 服务端还有 CFNetwork/okhttp UA 兜底识别。自定义 API 端点不需要。
    ...(useCustom ? {} : { 'X-Bayze-Client': 'mobile-app' }),
  }

  const body = useCustom
    ? JSON.stringify({ model, messages: allMessages, stream: true })
    : JSON.stringify({ model, messages: allMessages, ...(scope ? { scope } : {}), ...(customerId ? { customerId } : {}) })

  // React Native's fetch does not expose a streaming body (res.body.getReader is
  // undefined), so we stream over XMLHttpRequest, whose responseText accumulates
  // and fires onprogress on both Expo Go and production native builds.
  async function* attempt(url: string): AsyncGenerator<string> {
    const queue: string[] = []
    let finished = false
    let failed: Error | null = null
    let wake: (() => void) | null = null
    const bump = () => { const w = wake; wake = null; w?.() }

    if (userStopped) throw new Error(USER_STOP)   // 换域窗口内点了停止:不再起第二跳
    const xhr = new XMLHttpRequest()
    activeXhr = xhr
    xhr.open('POST', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)

    // 停滞看门狗:330s(> 服务端 maxDuration 300s)无任何进展 = 连接静默死亡。
    // 不用 xhr.timeout —— 那是总时长上限,会腰斩正常的长生成;这里每次进展都重置。
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        failed = new Error(STALL_MSG)
        try { xhr.abort() } catch {}
        finished = true; bump()
      }, 330_000)
    }
    armStall()

    let seen = 0
    let buf  = ''
    const consumeResponse = (flush = false) => {
      buf += xhr.responseText.slice(seen)
      seen = xhr.responseText.length
      const lines = buf.split('\n')
      buf = flush ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const normalized = line.trimEnd()
        if (!normalized.startsWith('data: ')) continue
        const payload = normalized.slice(6)
        if (payload === '[DONE]') continue
        try {
          const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content
          if (delta) queue.push(delta)
        } catch {}
      }
      bump()
    }
    xhr.onprogress = () => { armStall(); consumeResponse() }
    xhr.onload = () => {
      if (stallTimer) clearTimeout(stallTimer)
      if (xhr.status >= 400) {
        let msg = `HTTP ${xhr.status}`
        try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg } catch {}
        failed = new Error(msg)
      } else {
        consumeResponse(true)
      }
      finished = true; bump()
    }
    xhr.onerror = () => {
      if (stallTimer) clearTimeout(stallTimer)
      failed = failed ?? new Error('Network request failed')
      finished = true; bump()
    }
    xhr.onabort = () => {
      if (stallTimer) clearTimeout(stallTimer)
      if (userStopped) failed = failed ?? new Error(USER_STOP)
      finished = true; bump()
    }
    // RN 的 OS 级空闲超时走 'timeout' 事件而非 'error'(iOS kCFURLErrorTimedOut)——不接就静默挂死
    xhr.ontimeout = () => {
      if (stallTimer) clearTimeout(stallTimer)
      failed = failed ?? new Error('Network request failed')
      finished = true; bump()
    }
    xhr.send(body)

    while (true) {
      if (queue.length) { yield queue.shift()!; continue }
      if (failed)   throw failed
      if (finished) return
      await new Promise<void>(resolve => { wake = resolve })
    }
  }

  // 自定义端点(BYOK)优先级最高,完全绕过多域名逻辑
  if (useCustom) { yield* attempt(`${customApiUrl.replace(/\/$/, '')}/chat/completions`); return }

  // 平台通道:多域名解析;网络层错误且尚未吐出任何内容 → 标记域失效换新域重试一次
  const base = await resolveBase()
  let yielded = false
  try {
    for await (const delta of attempt(`${base}/api/chat`)) { yielded = true; yield delta }
  } catch (err) {
    if (yielded || !(err instanceof Error) || err.message === USER_STOP) throw err
    if (!/Network request failed/i.test(err.message) && err.message !== STALL_MSG) throw err
    await markBaseBad()
    const next = await resolveBase()
    yield* attempt(`${next}/api/chat`)
  }
}

// ── 知识库入库(1.3.4-C):分享/附件内容一键存入知识库。scope=org 任何企业成员可传;
//    未加入企业(403)自动落个人库。文本须已抽取(文档走 /api/extract 同一条路)。
export async function saveToKnowledge(opts: { accessToken: string; name: string; text: string }): Promise<'org' | 'personal'> {
  const { accessToken, name, text } = opts
  const post = (scope?: 'org') => apiFetch('/api/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, text, ...(scope ? { scope } : {}) }),
  })
  let savedTo: 'org' | 'personal' = 'org'
  let res = await post('org')
  if (res.status === 403) { savedTo = 'personal'; res = await post(undefined) }   // 不在企业 → 存个人库
  const json = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new Error(json.error ?? `保存失败(${res.status})`)
  return savedTo
}
