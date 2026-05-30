const APP_URL = 'https://app.lanwealth.com'

export const MODELS = [
  { id: 'deepseek-v3',      name: 'DeepSeek V3',      tag: 'Fast',      group: 'DeepSeek', free: true  },
  { id: 'deepseek-r1',      name: 'DeepSeek R1',      tag: 'Reasoning', group: 'DeepSeek', free: false },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tag: 'Fast',      group: 'Google',   free: true  },
  { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   tag: 'Advanced',  group: 'Google',   free: false },
  { id: 'claude-haiku-4-5',   name: 'Claude Haiku 4',   tag: 'Fast',      group: 'Claude',   free: false },
  { id: 'claude-sonnet-4-5',  name: 'Claude Sonnet 4',  tag: 'Balanced',  group: 'Claude',   free: false },
  { id: 'claude-opus-4-5',    name: 'Claude Opus 4',    tag: 'Advanced',  group: 'Claude',   free: false },
  { id: 'gpt-4o-mini',      name: 'GPT-4o mini',      tag: 'Fast',      group: 'OpenAI',   free: false },
  { id: 'gpt-4o',           name: 'GPT-4o',           tag: 'Balanced',  group: 'OpenAI',    free: false },
  { id: 'doubao-seed-lite', name: 'Doubao Seed Lite', tag: 'Fast',      group: 'ByteDance', free: false },
  { id: 'doubao-seed-pro',  name: 'Doubao Seed Pro',  tag: 'Balanced',  group: 'ByteDance', free: false },
  { id: 'qwen-turbo',       name: 'Qwen Turbo',       tag: 'Fast',      group: 'Qwen',      free: true  },
  { id: 'qwen-plus',        name: 'Qwen Plus',        tag: 'Balanced',  group: 'Qwen',      free: false },
  { id: 'qwen3-235b',       name: 'Qwen3 235B',       tag: 'Advanced',  group: 'Qwen',      free: false },
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

export type Message = { role: 'user' | 'assistant' | 'system'; content: string }

interface ChatOptions {
  accessToken:   string
  model:         string
  messages:      Message[]
  responseLang?: string   // ISO code — prepended as system prompt
  customApiUrl?: string   // OpenAI-compatible base URL (BYOK)
  customApiKey?: string   // API key for custom endpoint
}

export async function* streamChat(opts: ChatOptions): AsyncGenerator<string> {
  const { accessToken, model, messages, responseLang, customApiUrl, customApiKey } = opts

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
    : JSON.stringify({ model, messages: allMessages })

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
  xhr.onprogress = () => {
    buf += xhr.responseText.slice(seen)
    seen = xhr.responseText.length
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue
      try {
        const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content
        if (delta) queue.push(delta)
      } catch {}
    }
    bump()
  }
  xhr.onload = () => {
    if (xhr.status >= 400) {
      let msg = `HTTP ${xhr.status}`
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg } catch {}
      failed = new Error(msg)
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
