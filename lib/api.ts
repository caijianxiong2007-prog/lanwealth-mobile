export const APP_URL = 'https://app.lanwealth.com'

// Mirrors the web ChatClient working set (ids must match gateway aliases on app.lanwealth.com).
// Gemini stays on 2.5 Flash until Google billing is enabled (free tier excludes 3.x). GLM-4.7 via 火山方舟.
export const MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tag: 'Fast',      group: 'DeepSeek',  free: true,  vision: false },
  { id: 'deepseek-v4-pro',   name: 'DeepSeek V4 Pro',   tag: 'Reasoning', group: 'DeepSeek',  free: false, vision: false },
  { id: 'gemini-2.5-flash',  name: 'Gemini 2.5 Flash',  tag: 'Fast',      group: 'Google',    free: true,  vision: true  },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  tag: 'Fast',      group: 'Claude',    free: false, vision: true  },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tag: 'Balanced',  group: 'Claude',    free: false, vision: true  },
  { id: 'claude-opus-4-8',   name: 'Claude Opus 4.8',   tag: 'Advanced',  group: 'Claude',    free: false, vision: true  },
  { id: 'gpt-5.4-mini',      name: 'GPT-5.4 mini',      tag: 'Fast',      group: 'OpenAI',    free: false, vision: true  },
  { id: 'gpt-5.4',           name: 'GPT-5.4',           tag: 'Balanced',  group: 'OpenAI',    free: false, vision: true  },
  { id: 'doubao-seed-lite',  name: 'Doubao 2.0 Lite',   tag: 'Fast',      group: 'ByteDance', free: false, vision: false },
  { id: 'doubao-seed-pro',   name: 'Doubao 2.0 Pro',    tag: 'Balanced',  group: 'ByteDance', free: false, vision: false },
  { id: 'qwen-turbo',        name: 'Qwen Turbo',        tag: 'Fast',      group: 'Qwen',      free: true,  vision: false },
  { id: 'qwen-plus',         name: 'Qwen Plus',         tag: 'Balanced',  group: 'Qwen',      free: false, vision: false },
  { id: 'qwen3-235b',        name: 'Qwen3 235B',        tag: 'Advanced',  group: 'Qwen',      free: false, vision: false },
  { id: 'glm-4.7',           name: 'GLM-4.7',           tag: 'Advanced',  group: 'Zhipu',     free: false, vision: false },
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

export async function* streamChat(opts: ChatOptions): AsyncGenerator<string> {
  const { accessToken, model, messages, responseLang, customApiUrl, customApiKey, scope, customerId } = opts

  // Prepend system language instruction if set
  const allMessages: Message[] = []
  if (responseLang) {
    const langNative = CHAT_LANGS.find(l => l.code === responseLang)?.native ?? responseLang
    allMessages.push({ role: 'system', content: `Please respond in ${langNative}.` })
  }
  allMessages.push(...messages)

  const useCustom = !!(customApiUrl && customApiKey)
  const url = useCustom
    ? `${customApiUrl.replace(/\/$/, '')}/chat/completions`
    : `${APP_URL}/api/chat`

  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${useCustom ? customApiKey : accessToken}`,
  }

  const body = useCustom
    ? JSON.stringify({ model, messages: allMessages, stream: true })
    : JSON.stringify({ model, messages: allMessages, ...(scope ? { scope } : {}), ...(customerId ? { customerId } : {}) })

  // React Native's fetch does not expose a streaming body (res.body.getReader is
  // undefined), so we stream over XMLHttpRequest, whose responseText accumulates
  // and fires onprogress on both Expo Go and production native builds.
  const queue: string[] = []
  let finished = false
  let failed: Error | null = null
  let wake: (() => void) | null = null
  const bump = () => { const w = wake; wake = null; w?.() }

  const xhr = new XMLHttpRequest()
  xhr.open('POST', url)
  for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)

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
  xhr.onprogress = () => consumeResponse()
  xhr.onload = () => {
    if (xhr.status >= 400) {
      let msg = `HTTP ${xhr.status}`
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg } catch {}
      failed = new Error(msg)
    } else {
      consumeResponse(true)
    }
    finished = true; bump()
  }
  xhr.onerror = () => { failed = new Error('Network request failed'); finished = true; bump() }
  xhr.send(body)

  while (true) {
    if (queue.length) { yield queue.shift()!; continue }
    if (failed)   throw failed
    if (finished) return
    await new Promise<void>(resolve => { wake = resolve })
  }
}
