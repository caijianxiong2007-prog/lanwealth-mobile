import { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
  Modal, Pressable, Linking, Image, Keyboard, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as ImagePicker    from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem     from 'expo-file-system'
import { useShareIntentContext } from 'expo-share-intent'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { supabase }                  from '../../lib/supabase'
import { APP_URL, streamChat, MODELS, CHAT_LANGS, messageText, contentImages } from '../../lib/api'
import type { Message, ContentPart } from '../../lib/api'
import { getSecret }                 from '../../lib/secureSettings'
import {
  createConversationId, deleteCloudConversation, fetchCloudConversations,
  loadLocalConversations, mergeConversations, saveCloudConversation, saveCloudConversations, saveLocalConversations,
} from '../../lib/conversations'
import type { MobileConversation } from '../../lib/conversations'

// Chat input attachments (images go to vision models; text files are inlined)
type Attachment =
  | { kind: 'image'; uri: string; dataUrl: string }
  | { kind: 'file';  name: string; text: string }

const TEXT_FILE_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'html', 'css', 'scss', 'py', 'java',
  'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sql',
  'sh', 'bash', 'zsh', 'env', 'log',
])
const DOC_FILE_EXTS = new Set(['pdf', 'docx', 'doc', 'pptx', 'xlsx'])
const IMAGE_FILE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])
const DOC_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])
const MAX_INLINE_TEXT_CHARS = 200_000
const MAX_DOC_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_DATA_URL_CHARS = 4_000_000

function extOf(nameOrUri?: string | null): string {
  const clean = (nameOrUri ?? '').split('?')[0].split('#')[0]
  const last = clean.split('/').pop() ?? clean
  const dot = last.lastIndexOf('.')
  return dot >= 0 ? last.slice(dot + 1).toLowerCase() : ''
}

function imageMime(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType
  const ext = extOf(asset.fileName ?? asset.uri)
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'image/jpeg'
}

function isTextLikeFile(asset: DocumentPicker.DocumentPickerAsset): boolean {
  const mime = (asset.mimeType ?? '').toLowerCase()
  if (mime.startsWith('text/')) return true
  if (['application/json', 'application/xml', 'application/javascript', 'application/x-javascript'].includes(mime)) return true
  return TEXT_FILE_EXTS.has(extOf(asset.name || asset.uri))
}

function isDocFile(asset: DocumentPicker.DocumentPickerAsset): boolean {
  return DOC_FILE_EXTS.has(extOf(asset.name || asset.uri)) || DOC_MIME_TYPES.has((asset.mimeType ?? '').toLowerCase())
}

function conversationPreview(conversation: MobileConversation): string {
  const message = [...conversation.messages].reverse().find(m => m.role !== 'system' && messageText(m.content).trim())
  return message ? messageText(message.content).replace(/\s+/g, ' ').trim().slice(0, 90) : 'No messages yet'
}

function conversationDate(updatedAt: number): string {
  const date = new Date(updatedAt)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0C0D16',
  bg2:     '#13152A',
  bg3:     '#1C1E35',
  bg4:     '#24263E',
  border:  '#252845',
  border2: '#303358',
  text:    '#E4E4EA',
  muted:   '#606070',
  dim:     '#38383F',
  teal:    '#1AEBA8',
  teal2:   '#0F8C63',
  teal3:   '#083D2B',
  red:     '#E8453C',
}

const SUGGESTIONS = [
  'Explain quantum computing simply',
  'Write a Python web scraper',
  'Review and improve my code',
  'Draft a professional email',
]

// Map chat response-language code → BCP-47 locale for speech recognition
const STT_LANG: Record<string, string> = {
  '': 'en-US', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', vi: 'vi-VN',
  th: 'th-TH', ms: 'ms-MY', id: 'id-ID', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA',
}

export default function ChatScreen() {
  const router = useRouter()
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareIntentError } = useShareIntentContext()
  const [guest,       setGuest]       = useState(false)   // anonymous user → free models only
  const [entitled,    setEntitled]    = useState(false)   // paid on web / active paid plan → full models on iOS (Guideline 3.1.3)
  const [model,       setModel]       = useState('deepseek-v4-flash')
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const [error,       setError]       = useState('')
  const [showModels,  setShowModels]  = useState(false)
  const [showLangs,   setShowLangs]   = useState(false)
  const [responseLang,  setResponseLang]  = useState('')      // '' = auto
  const [customApiUrl,  setCustomApiUrl]  = useState('')
  const [customApiKey,  setCustomApiKey]  = useState('')
  const [convTitle,     setConvTitle]     = useState('')      // conversation display name
  const [showRename,    setShowRename]    = useState(false)
  const [renameInput,   setRenameInput]   = useState('')
  const [deleteLocked,  setDeleteLocked]  = useState(true)   // delete protection ON by default
  const [attachments,   setAttachments]   = useState<Attachment[]>([])
  const [showAttach,    setShowAttach]    = useState(false)
  const [listening,     setListening]     = useState(false)   // voice input active
  const [conversations, setConversations] = useState<MobileConversation[]>([])
  const [activeConvId,  setActiveConvId]  = useState<string | null>(null)
  const [showHistory,   setShowHistory]   = useState(false)
  const [historyQuery,  setHistoryQuery]  = useState('')
  const [historyLoading,setHistoryLoading]= useState(true)
  const voiceBaseRef = useRef('')          // input text captured when voice started
  const listRef    = useRef<FlatList>(null)
  const lockTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conversationsRef = useRef<MobileConversation[]>([])
  const activeConvIdRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const shareIntentBusyRef = useRef(false)

  const curModel = MODELS.find(m => m.id === model) ?? MODELS[0]
  const curLang  = CHAT_LANGS.find(l => l.code === responseLang) ?? CHAT_LANGS[0]
  const showExternalBilling = Platform.OS !== 'ios'
  // iOS shows NO purchase UI (no top-up / pricing / external billing links).
  // Free/guest users get free models only. Users who purchased a plan or credits
  // on the web (entitled) unlock the full model set on iOS — accessing a service
  // they already paid for elsewhere (Guideline 3.1.3 Multiplatform). On Android,
  // signed-in users get all models; guests get free only.
  const iosRestricted = Platform.OS === 'ios' && !entitled
  const freeOnly      = iosRestricted || guest
  const visibleModels = iosRestricted ? MODELS.filter(m => m.free) : MODELS

  // Load local history first, then merge the signed-in user's cross-device cloud history.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadLocalConversations(),
      AsyncStorage.getItem('response_lang'),
      AsyncStorage.getItem('custom_api_url'),
      getSecret('custom_api_key'),
    ]).then(async ([local, lang, apiUrl, apiKey]) => {
      if (cancelled) return
      if (lang) setResponseLang(lang)
      if (apiUrl) setCustomApiUrl(apiUrl)
      if (apiKey) setCustomApiKey(apiKey)

      conversationsRef.current = local.conversations
      setConversations(local.conversations)
      const localActive = local.conversations.find(c => c.id === local.activeId) ?? local.conversations[0] ?? null
      activeConvIdRef.current = localActive?.id ?? null
      setActiveConvId(localActive?.id ?? null)
      setMessages(localActive?.messages ?? [])
      setConvTitle(localActive?.title ?? '')
      if (localActive?.model) setModel(localActive.model)
      setHistoryLoading(false)

      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      userIdRef.current = user?.id ?? null
      if (user) {
        try {
          const cloud = await fetchCloudConversations(user.id)
          const deleted = new Set(cloud.deletedIds)
          const localNow = mergeConversations(conversationsRef.current, local.conversations).filter(c => !deleted.has(c.id))
          const merged = mergeConversations(localNow, cloud.conversations)
          const cloudById = new Map(cloud.conversations.map(c => [c.id, c]))
          const localChanges = localNow.filter(c => !cloudById.has(c.id) || c.updatedAt > cloudById.get(c.id)!.updatedAt)
          if (localChanges.length) void saveCloudConversations(user.id, localChanges).catch(() => undefined)
          if (cancelled) return
          conversationsRef.current = merged
          setConversations(merged)
          const selectedId = activeConvIdRef.current
          const selected = selectedId && !deleted.has(selectedId)
            ? merged.find(c => c.id === selectedId) ?? null
            : merged[0] ?? null
          if (selected) {
            activeConvIdRef.current = selected.id
            setActiveConvId(selected.id)
            setMessages(selected.messages)
            setConvTitle(selected.title)
            setModel(selected.model)
          } else if (selectedId && deleted.has(selectedId)) {
            const freshId = createConversationId()
            activeConvIdRef.current = freshId
            setActiveConvId(freshId)
            setMessages([])
            setConvTitle('')
          }
          await saveLocalConversations(merged, activeConvIdRef.current)
        } catch { /* keep local history available offline */ }
      }
    }).catch(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  useEffect(() => { activeConvIdRef.current = activeConvId }, [activeConvId])

  // Detect guest (anonymous) users + paid entitlement.
  // Entitlement = the user actually purchased on the web (net paid > 0) or has an
  // active paid plan. Signup bonus credits do NOT count. Used only to decide which
  // models to show on iOS — there is no purchase UI in the app (Guideline 3.1.3).
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      const isAnon = !!user?.is_anonymous
      setGuest(isAnon)
      if (!user || isAnon) { setEntitled(false); return }
      const { data: profile } = await supabase
        .from('users')
        .select('plan, plan_period_end, total_paid_usd, total_refunded_usd')
        .eq('id', user.id)
        .single() as { data: { plan: string | null; plan_period_end: string | null; total_paid_usd: number | null; total_refunded_usd: number | null } | null }
      if (!profile) { setEntitled(false); return }
      const netPaid    = (profile.total_paid_usd ?? 0) - (profile.total_refunded_usd ?? 0)
      const activePlan = !!profile.plan && profile.plan !== 'free' &&
        (!profile.plan_period_end || new Date(profile.plan_period_end) > new Date())
      setEntitled(netPaid > 0 || activePlan)
    })
  }, [])

  // 公司/个人 双模式(对齐网页版布局,2026-07-18):仅当用户在企业内且企业政策允许时
  // 显示切换。个人模式由服务端双向隔离(不读不写企业记忆/文件);游客与非企业成员无此概念。
  const [chatScope, setChatScope] = useState<'company' | 'personal'>('company')
  const [personalModeAvail, setPersonalModeAvail] = useState(false)
  const [inOrg, setInOrg] = useState(false)
  useEffect(() => {
    if (guest) { setPersonalModeAvail(false); setInOrg(false); return }
    let cancelled = false
    // ⚠️ 冷启动竞态(1.3.0 实测):App 刚启动时 getSession() 可能在会话恢复完成前返回 null,
    // 只拉一次企业身份会永远拉空 → 工具条不显示。改为:立即拉一次 + 监听 auth 状态
    // (INITIAL_SESSION/SIGNED_IN/TOKEN_REFRESHED)到位后重拉。
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return
      try {
        const r = await fetch(`${APP_URL}/api/org/settings`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        const j = await r.json().catch(() => ({})) as { in_org?: boolean; allow_personal_mode?: boolean }
        if (cancelled) return
        setInOrg(Boolean(j?.in_org))
        setPersonalModeAvail(Boolean(j?.in_org) && j?.allow_personal_mode !== false)
      } catch { /* 拉不到暂不显示,auth 事件到来时会重试 */ }
    }
    void load()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { if (session) void load() })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [guest])

  // 关联客户 + 记入企业知识(对齐网页版,2026-07-18)。端点与网页同一套(Bearer 鉴权):
  // GET /api/org/customers · POST /api/org/knowhow/extract · POST customers/{id}/extract→notes。
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const [showCustPicker, setShowCustPicker] = useState(false)
  const [sinking, setSinking] = useState(false)
  const sunkKnowhowRef = useRef<Set<string>>(new Set())
  const sunkCustRef = useRef<Set<string>>(new Set())

  // 模型偶尔无视 persona 禁令输出裸 HTML 标签(实测 Gemini Flash-Lite 吐 <br><small>),
  // 渲染前按白名单剥离;只动已知无害标签,不误伤 "a < b" 这类正文。
  function stripStrayHtml(t: string): string {
    return t
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:small|b|i|em|strong|u|sub|sup|span|p|div|hr|h[1-6])\b[^>]*>/gi, '')
  }

  function convoPlainText(msgs: Message[]): string {
    return msgs.filter(m => m.role !== 'system').map(m => {
      const body = messageText(m.content)
      return `${m.role === 'user' ? '我方' : 'AI'}: ${body}`
    }).join('\n').slice(0, 12000)
  }

  async function bearerHeaders(): Promise<Record<string, string> | null> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
  }

  // 切走/新建会话时对刚离开的会话静默沉淀(与网页 autoSinkKnowhow/autoSinkCustomer 同规则:
  // 企业成员、公司模式、≥2轮、每会话一次;best-effort 失败静默)。
  function autoSinkOnLeave() {
    if (!inOrg || chatScope === 'personal') return
    const convId = activeConvIdRef.current
    if (!convId) return
    const msgs = messages
    if (msgs.filter(m => m.role === 'user').length < 2) return
    const text = convoPlainText(msgs)
    if (!text.trim()) return
    const custId = customerId
    void bearerHeaders().then(headers => {
      if (!headers) return
      if (!sunkKnowhowRef.current.has(convId)) {
        sunkKnowhowRef.current.add(convId)
        fetch(`${APP_URL}/api/org/knowhow/extract`, { method: 'POST', headers, body: JSON.stringify({ text }) }).catch(() => undefined)
      }
      if (custId && !sunkCustRef.current.has(convId)) {
        sunkCustRef.current.add(convId)
        fetch(`${APP_URL}/api/org/customers/${custId}/extract`, { method: 'POST', headers, body: JSON.stringify({ text }) })
          .then(r => r.json()).then(j => {
            const points: string[] = Array.isArray(j?.points) ? j.points : []
            if (points.length) return fetch(`${APP_URL}/api/org/customers/${custId}/notes`, { method: 'POST', headers, body: JSON.stringify({ contents: points }) })
          }).catch(() => undefined)
      }
    })
  }

  // 「＋记入企业知识」手动沉淀:即时全公司生效(auto 级),管理员可在企业页复核。
  async function sinkKnowhow() {
    if (sinking) return
    const convId = activeConvIdRef.current
    const text = convoPlainText(messages)
    if (!text.trim()) { Alert.alert('当前对话为空', '先聊几句再记入企业知识。'); return }
    const headers = await bearerHeaders()
    if (!headers) { Alert.alert('请先登录'); return }
    setSinking(true)
    try {
      const r = await fetch(`${APP_URL}/api/org/knowhow/extract`, { method: 'POST', headers, body: JSON.stringify({ text }) })
      const j = await r.json().catch(() => ({}))
      if (j?.ok) {
        if (convId) sunkKnowhowRef.current.add(convId)
        Alert.alert('已记入', j.added ? `已记入 ${j.added} 条企业知识,即时全公司生效(管理员可在企业页复核)。` : '未提炼出可沉淀的新知识(可能已存在)。')
      } else Alert.alert('记入失败', String(j?.error ?? '请重试'))
    } catch { Alert.alert('记入失败', '网络异常,请重试') }
    setSinking(false)
  }

  async function openCustomerPicker() {
    setShowCustPicker(true)
    const headers = await bearerHeaders()
    if (!headers) return
    fetch(`${APP_URL}/api/org/customers`, { headers })
      .then(r => r.json())
      .then(j => setCustomers((Array.isArray(j?.customers) ? j.customers : []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => undefined)
  }

  async function openAuth() {
    if (guest) await supabase.auth.signOut()
    router.push('/(auth)/login')
  }

  // ── Voice input (on-device speech-to-text) ───────────────────────
  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results?.[0]?.transcript ?? ''
    const base = voiceBaseRef.current
    setInput((base ? base + ' ' : '') + t)
  })
  useSpeechRecognitionEvent('end', () => setListening(false))
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false)
    if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
      setError(`Voice input: ${e.message || e.error}`)
    }
  })

  async function toggleVoice() {
    if (listening) { try { ExpoSpeechRecognitionModule.stop() } catch {} setListening(false); return }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Microphone access needed', 'Enable microphone & speech recognition in Settings to dictate messages.')
      return
    }
    voiceBaseRef.current = input.trim()
    setError('')
    setListening(true)
    try {
      ExpoSpeechRecognitionModule.start({
        lang: STT_LANG[responseLang] ?? 'en-US',
        interimResults: true,
        continuous: false,
      })
    } catch {
      setListening(false)
      setError('Voice input is unavailable on this device.')
    }
  }

  // Keep the selected model within the free set whenever restricted
  // (always on iOS; for guests on Android) — e.g. after loading an old conversation.
  useEffect(() => {
    if (freeOnly && !(MODELS.find(x => x.id === model)?.free)) {
      setModel(MODELS.find(x => x.free)?.id ?? model)
    }
  }, [freeOnly, model])

  // Pick a model from the sheet; guests can't select locked (premium) models
  function selectModel(m: typeof MODELS[number]) {
    if (guest && !m.free) {
      Alert.alert(
        'Sign in to unlock',
        `${m.name} is available with an account. Free models are available to guests — sign in or create a free account to use all models.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Sign in', onPress: () => { setShowModels(false); void openAuth() } },
        ],
      )
      return
    }
    setModel(m.id)
    setShowModels(false)
  }

  // ── Attachments (photo / camera / file) ──────────────────────────
  // When an image is attached but the current model can't see images,
  // auto-switch to the best available vision model (respects free-only).
  function ensureVisionModel() {
    if (curModel.vision) return
    const v = visibleModels.find(m => m.vision)
    if (v) setModel(v.id)
  }

  async function addImage(asset: ImagePicker.ImagePickerAsset): Promise<boolean> {
    const mime = imageMime(asset)
    let base64 = asset.base64 ?? ''
    if (!base64 && asset.uri) {
      try {
        base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
      } catch { /* handled below */ }
    }
    if (!base64) {
      Alert.alert('Could not attach image', 'Please choose a local photo or take a new picture.')
      return false
    }
    const dataUrl = `data:${mime};base64,${base64}`
    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      Alert.alert('Image too large', 'Please choose a smaller image or reduce its resolution before attaching it.')
      return false
    }
    setAttachments(prev => [...prev, { kind: 'image', uri: asset.uri || dataUrl, dataUrl }])
    ensureVisionModel()
    return true
  }

  async function pickPhoto() {
    setShowAttach(false)
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Enable photo access in Settings to attach an image.')
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], base64: true, quality: 0.6,
    })
    if (!res.canceled && res.assets[0]) await addImage(res.assets[0])
  }

  async function takePhoto() {
    setShowAttach(false)
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.'); return }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 })
    if (!res.canceled && res.assets[0]) await addImage(res.assets[0])
  }

  async function extractDocumentText(f: DocumentPicker.DocumentPickerAsset, accessToken: string): Promise<string> {
    let res: Response
    if ((f.size ?? 0) > 4 * 1024 * 1024) {
      // >4MB 直传 /api/extract 会撞 Vercel 平台 ~4.5MB 请求体上限(平台层 413,到不了代码)。
      // 与网页版同方案:签名直传存储 → 按 storagePath 解析(2026-07-18 补齐,此前必失败)。
      const ur = await fetch(`${APP_URL}/api/extract/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: f.name, size: f.size ?? 0 }),
      })
      const uj = await ur.json().catch(() => ({})) as { signedUrl?: string; path?: string; error?: string }
      if (!ur.ok || !uj?.signedUrl || !uj?.path) throw new Error(uj?.error ?? `Upload channel failed (${ur.status})`)
      const fileBlob = await (await fetch(f.uri)).blob()
      const put = await fetch(uj.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': f.mimeType ?? 'application/octet-stream', 'x-upsert': 'false' },
        body: fileBlob,
      })
      if (!put.ok) throw new Error(`File upload failed (${put.status}), please retry.`)
      res = await fetch(`${APP_URL}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ storagePath: uj.path, name: f.name }),
      })
    } else {
      const fd = new FormData()
      fd.append('file', {
        uri:  f.uri,
        name: f.name,
        type: f.mimeType ?? 'application/octet-stream',
      } as unknown as Blob)
      fd.append('name', f.name)
      res = await fetch(`${APP_URL}/api/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      })
    }
    const json = await res.json().catch(() => ({})) as { text?: string; error?: string; truncated?: boolean }
    if (!res.ok) throw new Error(json.error ?? `Could not read file (${res.status})`)
    const text = String(json.text ?? '').trim()
    if (!text) throw new Error('No extractable text found in the file.')
    return json.truncated ? `${text}\n\n[Document was truncated to fit the chat context.]` : text
  }

  async function addDocument(f: DocumentPicker.DocumentPickerAsset): Promise<boolean> {
    const isDoc = isDocFile(f)
    if ((f.size ?? 0) > (isDoc ? MAX_DOC_BYTES : MAX_INLINE_TEXT_CHARS)) {
      Alert.alert('File too large', isDoc ? 'Please attach a document under 25 MB.' : 'Please attach a text or code file under ~200 KB.')
      return false
    }
    if (!isDoc && !isTextLikeFile(f)) {
      Alert.alert('Unsupported file', 'Bayze can read PDF, Word, PowerPoint, Excel (.xlsx), CSV, Markdown, JSON, XML and code/text files.')
      return false
    }
    try {
      let text = ''
      if (isDoc) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { Alert.alert('Sign in required', 'Please sign in before attaching documents.'); return false }
        text = await extractDocumentText(f, session.access_token)
      } else {
        text = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.UTF8 })
      }
      if (text.length > MAX_INLINE_TEXT_CHARS) text = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[File was truncated to fit the chat context.]`
      if (!text.trim()) { Alert.alert('Empty file', 'This file does not contain readable text.'); return false }
      setAttachments(prev => [...prev, { kind: 'file', name: f.name, text }])
      return true
    } catch (err) {
      Alert.alert('Could not read file', err instanceof Error ? err.message : 'Please try another file.')
      return false
    }
  }

  async function pickFile() {
    setShowAttach(false)
    const res = await DocumentPicker.getDocumentAsync({
      // Narrow MIME/UTI filters can hide valid files. Validate after selection.
      type: '*/*',
      copyToCacheDirectory: true,
    })
    if (!res.canceled && res.assets[0]) await addDocument(res.assets[0])
  }

  // Receive photos, documents, text and links shared from WeChat or another app.
  useEffect(() => {
    if (!hasShareIntent || shareIntentBusyRef.current) return
    shareIntentBusyRef.current = true

    const consumeShareIntent = async () => {
      try {
        setShowAttach(false)
        setShowHistory(false)
        setError('')

        const sharedText = (shareIntent.text || shareIntent.webUrl || '').trim()
        if (sharedText) setInput(previous => previous.trim() ? `${previous}\n${sharedText}` : sharedText)

        for (const file of shareIntent.files ?? []) {
          const name = file.fileName || file.path.split('/').pop() || 'shared-file'
          const mime = (file.mimeType || '').toLowerCase()
          const extension = extOf(name || file.path)
          if (mime.startsWith('image/') || IMAGE_FILE_EXTS.has(extension)) {
            await addImage({
              uri: file.path,
              fileName: name,
              mimeType: mime || undefined,
              width: file.width ?? 0,
              height: file.height ?? 0,
            } as ImagePicker.ImagePickerAsset)
          } else {
            await addDocument({
              uri: file.path,
              name,
              mimeType: mime || undefined,
              size: file.size ?? undefined,
            })
          }
        }
      } finally {
        resetShareIntent()
        shareIntentBusyRef.current = false
      }
    }

    void consumeShareIntent()
  }, [hasShareIntent, shareIntent, resetShareIntent])

  useEffect(() => {
    if (shareIntentError) setError(`Could not receive shared content: ${shareIntentError}`)
  }, [shareIntentError])

  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, idx) => idx !== i))
  }

  function persistConversation(conversation: MobileConversation) {
    const next = [conversation, ...conversationsRef.current.filter(c => c.id !== conversation.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 80)
    conversationsRef.current = next
    setConversations(next)
    void saveLocalConversations(next, conversation.id)
    const userId = userIdRef.current
    if (userId) void saveCloudConversation(userId, conversation).catch(() => undefined)
  }

  function startNewChat() {
    if (streaming) return
    autoSinkOnLeave()
    setCustomerId(''); setCustomerName('')
    const id = createConversationId()
    activeConvIdRef.current = id
    setActiveConvId(id)
    setMessages([])
    setConvTitle('')
    setInput('')
    setAttachments([])
    setError('')
    setShowHistory(false)
    void saveLocalConversations(conversationsRef.current, id)
    relock()
  }

  function switchConversation(id: string) {
    if (streaming || id === activeConvId) { setShowHistory(false); return }
    const target = conversationsRef.current.find(c => c.id === id)
    if (!target) return
    autoSinkOnLeave()
    setCustomerId(''); setCustomerName('')
    activeConvIdRef.current = target.id
    setActiveConvId(target.id)
    setMessages(target.messages)
    setConvTitle(target.title)
    setModel(target.model)
    setInput('')
    setAttachments([])
    setError('')
    setShowHistory(false)
    void saveLocalConversations(conversationsRef.current, target.id)
    relock()
  }

  function removeConversation(id: string) {
    if (streaming) return
    const next = conversationsRef.current.filter(c => c.id !== id)
    conversationsRef.current = next
    setConversations(next)
    let nextActiveId = activeConvId
    if (id === activeConvId) {
      const target = next[0] ?? null
      nextActiveId = target?.id ?? createConversationId()
      activeConvIdRef.current = nextActiveId
      setActiveConvId(nextActiveId)
      setMessages(target?.messages ?? [])
      setConvTitle(target?.title ?? '')
      if (target?.model) setModel(target.model)
      setInput('')
      setAttachments([])
    }
    void saveLocalConversations(next, nextActiveId)
    const userId = userIdRef.current
    if (userId) void deleteCloudConversation(userId, id).catch(() => undefined)
    relock()
  }

  function confirmRemoveConversation(id: string) {
    Alert.alert('Delete conversation?', 'This removes the conversation from all synced devices.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeConversation(id) },
    ])
  }

  const send = useCallback(async (text?: string) => {
    const trimmed = (text ?? input).trim()
    if ((!trimmed && attachments.length === 0) || streaming) return
    setError('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('Not authenticated'); return }

    setInput(''); Keyboard.dismiss()
    try { ExpoSpeechRecognitionModule.stop() } catch {} setListening(false)

    // Build content: plain string, or multimodal parts when attachments exist
    let content: string | ContentPart[]
    if (attachments.length > 0) {
      const parts: ContentPart[] = []
      for (const a of attachments) {
        if (a.kind === 'image') parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
        else parts.push({ type: 'text', text: `[File: ${a.name}]\n${a.text}` })
      }
      if (trimmed) parts.push({ type: 'text', text: trimmed })
      content = parts
    } else {
      content = trimmed
    }
    const hadAttachments = attachments.length > 0
    setAttachments([])

    // Auto-set conversation title from first user message
    const nextTitle = messages.length === 0 && !convTitle
      ? ((messageText(content) || (hadAttachments ? 'Image chat' : 'New chat')).slice(0, 40))
      : (convTitle || 'New chat')
    const conversationId = activeConvId ?? createConversationId()
    activeConvIdRef.current = conversationId
    setActiveConvId(conversationId)
    setConvTitle(nextTitle)

    const userMsg: Message     = { role: 'user', content }
    const asstSlot: Message    = { role: 'assistant', content: '' }
    const baseMessages         = [...messages, userMsg]
    let finalMessages          = [...baseMessages, asstSlot]
    setMessages(finalMessages)
    setStreaming(true)

    try {
      for await (const delta of streamChat({
        accessToken:  session.access_token,
        model,
        messages:     [...messages, userMsg],
        responseLang: responseLang || undefined,
        customApiUrl: customApiUrl || undefined,
        customApiKey: customApiKey || undefined,
        scope:        inOrg ? chatScope : undefined,
        customerId:   inOrg && chatScope === 'company' && customerId ? customerId : undefined,
      })) {
        const current = finalMessages[finalMessages.length - 1]
        finalMessages = [
          ...baseMessages,
          { ...current, content: (typeof current.content === 'string' ? current.content : '') + delta },
        ]
        setMessages(finalMessages)
        listRef.current?.scrollToEnd({ animated: false })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
      finalMessages = baseMessages
      setMessages(finalMessages)
    } finally {
      persistConversation({
        id: conversationId,
        title: nextTitle,
        model,
        messages: finalMessages.slice(-120),
        updatedAt: Date.now(),
      })
      setStreaming(false)
    }
  }, [input, streaming, messages, model, responseLang, customApiUrl, customApiKey, convTitle, attachments, activeConvId, chatScope, inOrg, customerId])

  function deleteActiveConversation() {
    if (!activeConvId) { startNewChat(); return }
    removeConversation(activeConvId)
  }

  // ── Delete lock helpers ──────────────────────────────────────
  function unlock() {
    if (lockTimer.current) clearTimeout(lockTimer.current)
    setDeleteLocked(false)
    lockTimer.current = setTimeout(() => setDeleteLocked(true), 15000)
  }

  function relock() {
    if (lockTimer.current) clearTimeout(lockTimer.current)
    setDeleteLocked(true)
  }

  // ── Export conversation ──────────────────────────────────────
  function exportConversation() {
    if (messages.length === 0) return
    const lines = messages.map(m =>
      `${m.role === 'user' ? 'You' : 'AI'}: ${messageText(m.content)}${contentImages(m.content).length ? '  [📷 image]' : ''}`
    ).join('\n\n---\n\n')
    const content = `# ${convTitle || 'Bayze Chat'}\n\n${lines}`
    // Share via native share sheet
    import('react-native').then(({ Share }) => {
      Share.share({ message: content, title: convTitle || 'Bayze Chat' })
    })
  }

  function saveRename() {
    const t = renameInput.trim()
    if (t) {
      setConvTitle(t)
      if (activeConvId && messages.length) {
        persistConversation({ id: activeConvId, title: t, model, messages, updatedAt: Date.now() })
      }
    }
    setShowRename(false)
  }

  const normalizedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredConversations = conversations.filter(conversation => {
    if (!normalizedHistoryQuery) return true
    return conversation.title.toLowerCase().includes(normalizedHistoryQuery) ||
      conversation.messages.some(message => messageText(message.content).toLowerCase().includes(normalizedHistoryQuery))
  })

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        {/* Left: 品牌行(对齐网页版:logo + Bayze 字标;模型选择移到第二行) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={s.headerLogo}>
            <Image source={require('../../assets/bayze-logo.png')} style={s.headerLogoImg} resizeMode="contain" />
          </View>
          <Text style={s.brandText}>Bayze</Text>
        </View>

        {/* Right: history + language + top-up */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity
            onPress={() => setShowHistory(true)}
            style={s.iconBtn}
            activeOpacity={0.7}
            disabled={streaming}
            accessibilityLabel="Conversation history"
          >
            <Ionicons name="time-outline" size={18} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowLangs(true)} style={s.iconBtn} activeOpacity={0.7}>
            <Text style={s.iconBtnText}>🌐</Text>
            {responseLang ? <Text style={s.langDot} /> : null}
          </TouchableOpacity>
          {showExternalBilling && (
            <TouchableOpacity
              onPress={() => Linking.openURL('https://app.lanwealth.com/dashboard/billing')}
              style={[s.iconBtn, { paddingHorizontal: 10 }]} activeOpacity={0.7}
            >
              <Text style={[s.iconBtnText, { color: C.teal, fontSize: 12 }]}>充值 +</Text>
            </TouchableOpacity>
          )}
          {/* 🗑 moved to title bar below */}
        </View>
      </View>

      {/* ── 第二行:模型选择 + 新会话(对齐网页版「模型下拉 + 清除」行) ── */}
      <View style={s.headerSub}>
        <TouchableOpacity onPress={() => setShowModels(true)} style={[s.modelBtn, { flex: 1 }]} activeOpacity={0.7}>
          <Text style={s.modelName} numberOfLines={1}>{curModel.name}</Text>
          {curModel.free && <Text style={s.freeBadge}>Free</Text>}
          <Text style={s.modelChevron}>▾</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={startNewChat} style={s.newChatBtn} activeOpacity={0.7} disabled={streaming}>
          <Text style={s.newChatTxt}>＋ 新会话</Text>
        </TouchableOpacity>
      </View>

      {/* ── Active conversation title bar + status strip ──────────────────── */}
      {messages.length > 0 && (
        <View>
          {/* Title row: conversation name + rename + export + delete-lock */}
          <View style={s.titleBar}>
            <Text style={s.titleBarText} numberOfLines={1}>
              {convTitle || 'New Chat'}
            </Text>
            {/* Rename */}
            <TouchableOpacity
              onPress={() => { setRenameInput(convTitle); setShowRename(true) }}
              style={s.titleBarIconBtn} activeOpacity={0.7}
            >
              <Text style={s.titleBarIcon}>✏</Text>
            </TouchableOpacity>
            {/* Export */}
            <TouchableOpacity onPress={exportConversation} style={s.titleBarIconBtn} activeOpacity={0.7}>
              <Text style={[s.titleBarIcon, { fontSize: 14 }]}>↑</Text>
            </TouchableOpacity>
            {/* Delete lock — tap lock icon to unlock, then tap again to delete */}
            <TouchableOpacity
              onPress={() => deleteLocked ? unlock() : deleteActiveConversation()}
              style={s.titleBarIconBtn} activeOpacity={0.7}
            >
              <Text style={[s.titleBarIcon, {
                color: deleteLocked ? C.teal : '#E8453C',
                opacity: deleteLocked ? 0.7 : 1,
              }]}>
                {deleteLocked ? '🔒' : '🗑'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 旧 status strip(模型名 + New chat)已并入头部第二行,不再重复 */}
        </View>
      )}

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      {messages.length === 0 ? (
        <View style={s.welcome}>
          <View style={s.welcomeLogoWrap}>
            <Image source={require('../../assets/bayze-logo.png')} style={s.welcomeLogoImg} resizeMode="contain" />
          </View>
          <View style={s.welcomeTitleRow}>
            <Text style={s.welcomeTitle}>Bayze</Text>
            <Text style={s.welcomeZh}>白泽</Text>
          </View>
          <Text style={s.welcomeSub}>
            {curModel.name}
            {responseLang ? `  ·  ${curLang.native}` : ''}
            {(customApiUrl && customApiKey) ? '  ·  Custom API' : ''}
          </Text>
          <View style={s.suggGrid}>
            {SUGGESTIONS.map(sg => (
              <TouchableOpacity key={sg} style={s.suggCard} onPress={() => send(sg)} activeOpacity={0.7}>
                <Text style={s.suggText}>{sg}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages.filter(m => m.role !== 'system')}
          keyExtractor={(_, i) => i.toString()}
          contentContainerStyle={s.msgList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: msg, index }) => (
            <View style={[
              s.msgRow,
              msg.role === 'user' ? s.userRow : s.asstRow,
            ]}>
              {msg.role === 'assistant' && (
                <View style={s.asstAvatar}>
                  <Image source={require('../../assets/bayze-logo.png')} style={{ width: 14, height: 14 }} resizeMode="contain" />
                </View>
              )}
              <View style={[
                s.bubble,
                msg.role === 'user' ? s.userBubble : s.asstBubble,
              ]}>
                {contentImages(msg.content).map((url, i) => (
                  <Image key={i} source={{ uri: url }} style={s.msgImage} resizeMode="cover" />
                ))}
                {messageText(msg.content)
                  ? <Text style={[s.msgText, msg.role === 'user' && s.userMsgText]} selectable>{stripStrayHtml(messageText(msg.content))}</Text>
                  : (typeof msg.content === 'string' && msg.content === ''
                      ? <Text style={{ color: C.teal, fontSize: 16 }}>▌</Text>
                      : null)
                }
                {msg.role === 'assistant' && streaming && index === messages.filter(m=>m.role!=='system').length - 1 && messageText(msg.content)
                  ? <Text style={{ color: C.teal }}>▌</Text> : null
                }
              </View>
              {msg.role === 'user' && (
                <View style={s.userAvatar}>
                  <Text style={{ fontSize: 11, color: C.teal }}>You</Text>
                </View>
              )}
            </View>
          )}
        />
      )}

      {error ? (
        <View style={s.errBar}>
          <Text style={s.errText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Attachment previews ────────────────────────────────────────────── */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={s.attachPreviewRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}
        >
          {attachments.map((a, i) => (
            <View key={i} style={s.attachChip}>
              {a.kind === 'image'
                ? <Image source={{ uri: a.uri }} style={s.attachThumb} resizeMode="cover" />
                : <View style={s.attachFileChip}><Text style={s.attachFileName} numberOfLines={1}>📄 {a.name}</Text></View>}
              <TouchableOpacity style={s.attachRemove} onPress={() => removeAttachment(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.attachRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── 企业工具条:公司/个人切换 · 关联客户 · 记入企业知识(对齐网页版) ── */}
      {inOrg && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scopeScroll} contentContainerStyle={s.scopeRow}>
          {personalModeAvail && (['company', 'personal'] as const).map(sc => (
            <TouchableOpacity key={sc} onPress={() => setChatScope(sc)} activeOpacity={0.7}
              style={[s.scopePill, chatScope === sc && s.scopePillOn]}>
              <Text style={[s.scopeTxt, chatScope === sc && s.scopeTxtOn]}>
                {sc === 'company' ? '🏢 公司' : '🔒 个人'}
              </Text>
            </TouchableOpacity>
          ))}
          {chatScope === 'company' ? (
            <>
              <TouchableOpacity style={[s.scopePill, !!customerId && s.scopePillCust]} onPress={openCustomerPicker} activeOpacity={0.7}>
                <Text style={s.scopeTxt} numberOfLines={1}>👤 {customerName || '关联客户'} ▾</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.scopePill} onPress={sinkKnowhow} disabled={sinking} activeOpacity={0.7}>
                <Text style={s.scopeTxt}>{sinking ? '记入中…' : '＋记入企业知识'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={s.scopeHint} numberOfLines={1}>个人模式:不读不写企业记忆</Text>
          )}
        </ScrollView>
      )}

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <View style={s.inputRow}>
        <TouchableOpacity
          style={s.attachBtn} onPress={() => setShowAttach(true)}
          disabled={streaming} activeOpacity={0.7}
        >
          <Text style={s.attachBtnText}>＋</Text>
        </TouchableOpacity>
        <TextInput
          style={s.inputField}
          value={input} onChangeText={setInput}
          multiline
          placeholder={listening ? 'Listening…' : `Message ${curModel.name}…`}
          placeholderTextColor={C.dim}
          editable={!streaming}
        />
        <TouchableOpacity
          style={[s.attachBtn, listening && { backgroundColor: C.red, borderColor: C.red }]}
          onPress={toggleVoice} disabled={streaming} activeOpacity={0.7}
        >
          <Text style={[s.attachBtnText, { fontSize: listening ? 16 : 17 }, listening && { color: '#fff' }]}>
            {listening ? '■' : '🎤'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.sendBtn, ((!input.trim() && attachments.length === 0) || streaming) && s.sendBtnDisabled]}
          onPress={() => send()}
          disabled={(!input.trim() && attachments.length === 0) || streaming}
          activeOpacity={0.8}
        >
          {streaming
            ? <ActivityIndicator size="small" color="#050505" />
            : <Text style={s.sendArrow}>↑</Text>
          }
        </TouchableOpacity>
      </View>

      {/* ── Conversation history ─────────────────────────────────────────── */}
      <Modal visible={showHistory} transparent animationType="slide" onRequestClose={() => setShowHistory(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowHistory(false)}>
          <Pressable style={[s.sheet, s.historySheet]} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <View style={s.historyHeader}>
              <View>
                <Text style={s.sheetTitle}>Conversation history</Text>
                <Text style={s.historyCount}>{conversations.length} saved conversations</Text>
              </View>
              <TouchableOpacity
                style={s.historyNewBtn}
                onPress={startNewChat}
                activeOpacity={0.8}
                accessibilityLabel="New conversation"
              >
                <Ionicons name="create-outline" size={19} color="#04130C" />
                <Text style={s.historyNewText}>New</Text>
              </TouchableOpacity>
            </View>

            <View style={s.historySearch}>
              <Ionicons name="search-outline" size={18} color={C.muted} />
              <TextInput
                value={historyQuery}
                onChangeText={setHistoryQuery}
                placeholder="Search titles and messages"
                placeholderTextColor={C.muted}
                style={s.historySearchInput}
                autoCorrect={false}
                returnKeyType="search"
              />
              {historyQuery ? (
                <TouchableOpacity onPress={() => setHistoryQuery('')} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={C.muted} />
                </TouchableOpacity>
              ) : null}
            </View>

            {historyLoading ? (
              <View style={s.historyEmpty}>
                <ActivityIndicator color={C.teal} />
                <Text style={s.historyEmptyText}>Syncing conversations…</Text>
              </View>
            ) : (
              <FlatList
                data={filteredConversations}
                keyExtractor={item => item.id}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={filteredConversations.length ? undefined : s.historyEmpty}
                ListEmptyComponent={<Text style={s.historyEmptyText}>{historyQuery ? 'No matching conversations' : 'No conversations yet'}</Text>}
                renderItem={({ item }) => (
                  <View style={[s.historyRow, item.id === activeConvId && s.historyRowActive]}>
                    <TouchableOpacity style={s.historyRowMain} onPress={() => switchConversation(item.id)} activeOpacity={0.7}>
                      <View style={s.historyRowTitleLine}>
                        <Text style={[s.historyRowTitle, item.id === activeConvId && { color: C.teal }]} numberOfLines={1}>{item.title}</Text>
                        <Text style={s.historyRowDate}>{conversationDate(item.updatedAt)}</Text>
                      </View>
                      <Text style={s.historyRowPreview} numberOfLines={1}>{conversationPreview(item)}</Text>
                      <Text style={s.historyRowModel} numberOfLines={1}>{MODELS.find(m => m.id === item.model)?.name ?? item.model}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.historyDeleteBtn}
                      onPress={() => confirmRemoveConversation(item.id)}
                      accessibilityLabel={`Delete ${item.title}`}
                    >
                      <Ionicons name="trash-outline" size={17} color={C.muted} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Attach action sheet ────────────────────────────────────────────── */}
      <Modal visible={showCustPicker} transparent animationType="slide" onRequestClose={() => setShowCustPicker(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowCustPicker(false)}>
          <Pressable style={s.sheet} onPress={() => undefined}>
            <Text style={s.sheetTitle}>关联客户</Text>
            <ScrollView>
              <TouchableOpacity style={s.custRow} activeOpacity={0.7}
                onPress={() => { setCustomerId(''); setCustomerName(''); setShowCustPicker(false) }}>
                <Text style={[s.custName, !customerId && { color: C.teal }]}>不关联</Text>
              </TouchableOpacity>
              {customers.map(c => (
                <TouchableOpacity key={c.id} style={s.custRow} activeOpacity={0.7}
                  onPress={() => { setCustomerId(c.id); setCustomerName(c.name); setShowCustPicker(false) }}>
                  <Text style={[s.custName, customerId === c.id && { color: C.teal }]} numberOfLines={1}>{c.name}</Text>
                </TouchableOpacity>
              ))}
              {customers.length === 0 && <Text style={s.scopeHint}>暂无客户(在网页版「客户记忆」页创建)</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAttach} transparent animationType="slide" onRequestClose={() => setShowAttach(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowAttach(false)}>
          <Pressable style={[s.sheet, { paddingBottom: 30 }]} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Add to message</Text>
            <TouchableOpacity style={s.attachAction} onPress={pickPhoto} activeOpacity={0.7}>
              <Text style={s.attachActionIcon}>🖼️</Text>
              <View><Text style={s.attachActionName}>Photo library</Text><Text style={s.sheetRowSub}>Attach an image to ask about it</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={s.attachAction} onPress={takePhoto} activeOpacity={0.7}>
              <Text style={s.attachActionIcon}>📷</Text>
              <View><Text style={s.attachActionName}>Take photo</Text><Text style={s.sheetRowSub}>Use the camera</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={[s.attachAction, { borderBottomWidth: 0 }]} onPress={pickFile} activeOpacity={0.7}>
              <Text style={s.attachActionIcon}>📄</Text>
              <View><Text style={s.attachActionName}>File</Text><Text style={s.sheetRowSub}>Text / code files</Text></View>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Rename Modal ──────────────────────────────────────────────────── */}
      <Modal visible={showRename} transparent animationType="fade" onRequestClose={() => setShowRename(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowRename(false)}>
          <Pressable style={[s.sheet, { paddingBottom: 24 }]} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Rename Conversation</Text>
            <TextInput
              style={[s.inputField, { marginHorizontal: 0, marginBottom: 16, backgroundColor: C.bg3, borderWidth: 1.5, borderColor: C.teal2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }]}
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="Enter conversation name…"
              placeholderTextColor={C.dim}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={saveRename}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[{ flex: 1, backgroundColor: C.teal2, borderRadius: 9, padding: 13, alignItems: 'center' }]}
                onPress={saveRename} activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ flex: 1, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border2, borderRadius: 9, padding: 13, alignItems: 'center' }]}
                onPress={() => setShowRename(false)} activeOpacity={0.8}
              >
                <Text style={{ color: C.muted, fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Model Picker Modal ─────────────────────────────────────────────── */}
      <Modal visible={showModels} transparent animationType="slide" onRequestClose={() => setShowModels(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowModels(false)}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select Model</Text>
            {/* Model list — always accessible, no lock */}
            {messages.length > 0 && (
              <Text style={{ fontSize: 11, color: C.teal, textAlign: 'center', marginBottom: 8, opacity: 0.8 }}>
                ✦ New model will read previous messages
              </Text>
            )}
            {guest && Platform.OS !== 'ios' && (
              <Text style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginBottom: 8 }}>
                🔒 Premium models need an account — sign in to unlock all
              </Text>
            )}
            <ScrollView showsVerticalScrollIndicator={false}>
              {visibleModels.map(m => {
                const locked = guest && !m.free
                return (
                <TouchableOpacity
                  key={m.id}
                  style={[s.sheetRow, m.id === model && s.sheetRowActive, locked && { opacity: 0.4 }]}
                  onPress={() => selectModel(m)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[s.sheetRowName, m.id === model && { color: C.teal }]}>{m.name}</Text>
                      {m.free ? (
                        <View style={s.freePill}>
                          <Text style={s.freePillText}>Free</Text>
                        </View>
                      ) : locked ? (
                        <View style={s.lockPill}>
                          <Text style={s.lockPillText}>🔒 Sign in</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.sheetRowSub}>{m.group} · {m.tag}</Text>
                  </View>
                  {m.id === model && <Text style={{ color: C.teal, fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
                )
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Language Picker Modal ──────────────────────────────────────────── */}
      <Modal visible={showLangs} transparent animationType="slide" onRequestClose={() => setShowLangs(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowLangs(false)}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>AI Response Language</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {CHAT_LANGS.map(l => (
                <TouchableOpacity
                  key={l.code}
                  style={[s.sheetRow, l.code === responseLang && s.sheetRowActive]}
                  onPress={() => {
                    setResponseLang(l.code)
                    AsyncStorage.setItem('response_lang', l.code)
                    setShowLangs(false)
                  }}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={[s.sheetRowName, l.code === responseLang && { color: C.teal }]}>
                      {l.native}
                    </Text>
                    {l.label !== l.native && (
                      <Text style={s.sheetRowSub}>{l.label}</Text>
                    )}
                  </View>
                  {l.code === responseLang && <Text style={{ color: C.teal, fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </KeyboardAvoidingView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Header
  header:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:14, paddingTop: Platform.OS==='ios' ? 54 : 14, paddingBottom:8, backgroundColor:C.bg2 },
  brandText:    { color:C.text, fontSize:17, fontWeight:'800', letterSpacing:0.3 },
  headerSub:    { flexDirection:'row', alignItems:'center', gap:8, paddingHorizontal:14, paddingBottom:10, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border },
  newChatBtn:   { paddingHorizontal:12, paddingVertical:7, borderRadius:8, borderWidth:1, borderColor:C.border2, backgroundColor:C.bg3 },
  newChatTxt:   { color:C.teal, fontSize:13, fontWeight:'600' },
  headerLogo:   { width:28, height:28, borderRadius:7, backgroundColor:'rgba(255,255,255,0.9)', alignItems:'center', justifyContent:'center', padding:3 },
  headerLogoImg:{ width:22, height:22 },
  modelBtn:     { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, paddingHorizontal:10, paddingVertical:6, flexShrink:1 },
  modelName:    { fontSize:13, fontWeight:'600', color:C.text, flexShrink:1 },
  modelChevron: { fontSize:10, color:C.muted },
  freeBadge:    { fontSize:9, color:C.teal, backgroundColor:C.teal3, borderRadius:4, paddingHorizontal:4, paddingVertical:1, fontWeight:'600' },
  iconBtn:      { padding:7, borderRadius:7, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center', position:'relative' },
  iconBtnText:  { fontSize:14, color:C.muted },
  langDot:      { position:'absolute', top:4, right:4, width:6, height:6, borderRadius:3, backgroundColor:C.teal },

  // Title bar (conversation title + rename + delete)
  titleBar:       { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:7, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border, gap:6 },
  titleBarText:   { flex:1, fontSize:13, fontWeight:'600', color:C.text },
  titleBarIconBtn:{ padding:5, borderRadius:6 },
  titleBarIcon:   { fontSize:13, color:C.dim },

  // Status strip
  statusStrip:  { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:5, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border },
  statusText:   { fontSize:11, color:'#333', flex:1 },
  statusNewChat:{ fontSize:11, color:C.teal, fontWeight:'600', paddingLeft:10 },

  // Welcome
  welcome:         { flex:1, alignItems:'center', justifyContent:'center', padding:24 },
  welcomeLogoWrap: { width:72, height:72, borderRadius:18, backgroundColor:'rgba(255,255,255,0.92)', alignItems:'center', justifyContent:'center', marginBottom:14, padding:7 },
  welcomeLogoImg:  { width:58, height:58 },
  welcomeTitleRow: { flexDirection:'row', alignItems:'baseline', gap:8, marginBottom:6 },
  welcomeTitle:    { fontSize:24, fontWeight:'700', color:C.text },
  welcomeZh:       { fontSize:14, color:'rgba(255,255,255,0.3)', letterSpacing:.6 },
  welcomeSub:      { fontSize:13, color:C.muted, marginBottom:28, textAlign:'center' },
  suggGrid:        { width:'100%', flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'center' },
  suggCard:        { width:'47%', backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:10, padding:13 },
  suggText:        { fontSize:13, color:C.muted, lineHeight:19 },

  // Messages
  msgList:     { padding:16, paddingBottom:8, gap:14 },
  msgRow:      { flexDirection:'row', alignItems:'flex-end', gap:8 },
  userRow:     { flexDirection:'row-reverse', alignSelf:'flex-end', maxWidth:'88%' },
  asstRow:     { alignSelf:'flex-start', maxWidth:'88%' },
  asstAvatar:  { width:26, height:26, borderRadius:8, backgroundColor:'rgba(255,255,255,0.85)', alignItems:'center', justifyContent:'center', flexShrink:0, marginBottom:2, padding:4 },
  userAvatar:  { width:26, height:26, borderRadius:13, backgroundColor:C.teal3, borderWidth:1, borderColor:C.teal2, alignItems:'center', justifyContent:'center', flexShrink:0, marginBottom:2 },
  bubble:      { maxWidth:'100%' },
  userBubble:  { backgroundColor:C.teal2, borderRadius:16, borderBottomRightRadius:4, paddingHorizontal:14, paddingVertical:10 },
  asstBubble:  { backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:16, borderBottomLeftRadius:4, paddingHorizontal:14, paddingVertical:10 },
  msgText:     { fontSize:15, color:C.text, lineHeight:23 },
  userMsgText: { color:'#fff' },

  // Error
  errBar:  { margin:12, backgroundColor:'rgba(232,69,60,.1)', borderWidth:1, borderColor:'rgba(232,69,60,.3)', borderRadius:8, padding:10 },
  errText: { color:C.red, fontSize:13 },

  // Input
  scopeScroll:  { flexGrow:0, marginTop:2 },
  scopeRow:     { flexDirection:'row', alignItems:'center', gap:8, paddingHorizontal:12 },
  scopePillCust:{ borderColor:C.teal },
  custRow:      { paddingVertical:12, borderBottomWidth:1, borderBottomColor:C.border2 },
  custName:     { color:C.text, fontSize:15 },
  scopePill:    { paddingVertical:5, paddingHorizontal:12, borderRadius:9, borderWidth:1, borderColor:C.border2, backgroundColor:C.bg3 },
  scopePillOn:  { backgroundColor:C.teal, borderColor:C.teal },
  scopeTxt:     { color:C.text, fontSize:12, fontWeight:'600' },
  scopeTxtOn:   { color:'#050505' },
  scopeHint:    { color:C.dim, fontSize:11, flexShrink:1 },
  inputRow:     { flexDirection:'row', alignItems:'flex-end', margin:12, gap:8, backgroundColor:C.bg3, borderWidth:1.5, borderColor:C.border2, borderRadius:14, padding:8, paddingLeft:14 },
  inputField:   { flex:1, color:C.text, fontSize:15, maxHeight:130, paddingVertical:4, lineHeight:22 },
  sendBtn:      { width:38, height:38, borderRadius:10, backgroundColor:C.teal, alignItems:'center', justifyContent:'center', flexShrink:0 },
  sendBtnDisabled: { opacity:0.3 },
  sendArrow:    { color:'#050505', fontSize:20, fontWeight:'800', marginTop:-1 },

  // Modals
  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end' },
  sheet:        { backgroundColor:C.bg2, borderTopLeftRadius:20, borderTopRightRadius:20, padding:20, paddingBottom:36, maxHeight:'75%' },
  sheetHandle:  { width:40, height:4, backgroundColor:C.border2, borderRadius:2, alignSelf:'center', marginBottom:16 },
  sheetTitle:   { fontSize:16, fontWeight:'700', color:C.text, marginBottom:14 },
  sheetRow:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:13, borderBottomWidth:1, borderBottomColor:C.border },
  sheetRowActive:{ backgroundColor:'rgba(26,235,168,0.04)', marginHorizontal:-4, paddingHorizontal:4, borderRadius:8 },
  sheetRowName: { fontSize:15, color:C.text, fontWeight:'500' },
  sheetRowSub:  { fontSize:12, color:C.muted, marginTop:2 },
  freePill:     { backgroundColor:C.teal3, borderRadius:5, paddingHorizontal:6, paddingVertical:2 },
  freePillText: { fontSize:10, color:C.teal, fontWeight:'600' },
  lockPill:     { backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2, borderRadius:5, paddingHorizontal:6, paddingVertical:2 },
  lockPillText: { fontSize:10, color:C.muted, fontWeight:'600' },

  // Conversation history
  historySheet:      { height:'82%', maxHeight:'82%', paddingBottom:24 },
  historyHeader:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14 },
  historyCount:      { fontSize:11, color:C.muted, marginTop:-8 },
  historyNewBtn:     { minWidth:76, height:36, borderRadius:8, backgroundColor:C.teal, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5, paddingHorizontal:10 },
  historyNewText:    { color:'#04130C', fontSize:13, fontWeight:'700' },
  historySearch:     { height:44, borderRadius:10, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, flexDirection:'row', alignItems:'center', gap:8, paddingHorizontal:12, marginBottom:10 },
  historySearchInput:{ flex:1, color:C.text, fontSize:14, paddingVertical:0 },
  historyRow:        { minHeight:88, flexDirection:'row', alignItems:'center', borderBottomWidth:1, borderBottomColor:C.border, paddingLeft:12 },
  historyRowActive:  { backgroundColor:'rgba(26,235,168,0.05)', borderLeftWidth:2, borderLeftColor:C.teal, paddingLeft:10 },
  historyRowMain:    { flex:1, minWidth:0, paddingVertical:12, paddingRight:8 },
  historyRowTitleLine:{ flexDirection:'row', alignItems:'center', gap:10 },
  historyRowTitle:   { flex:1, minWidth:0, color:C.text, fontSize:14, fontWeight:'600' },
  historyRowDate:    { color:C.muted, fontSize:10, flexShrink:0 },
  historyRowPreview: { color:'#77798A', fontSize:12, marginTop:5 },
  historyRowModel:   { color:C.dim, fontSize:10, marginTop:4 },
  historyDeleteBtn:  { width:42, height:42, alignItems:'center', justifyContent:'center', flexShrink:0 },
  historyEmpty:      { flexGrow:1, minHeight:180, alignItems:'center', justifyContent:'center', gap:10 },
  historyEmptyText:  { color:C.muted, fontSize:13, textAlign:'center' },

  // Message image (in-bubble thumbnail)
  msgImage:     { width:200, height:200, borderRadius:10, marginBottom:6, backgroundColor:C.bg4 },

  // Attachment previews (above input)
  attachPreviewRow: { maxHeight:78, marginBottom:-4 },
  attachChip:    { position:'relative' },
  attachThumb:   { width:60, height:60, borderRadius:10, backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2 },
  attachFileChip:{ height:60, maxWidth:160, paddingHorizontal:12, borderRadius:10, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center' },
  attachFileName:{ fontSize:12, color:C.text },
  attachRemove:  { position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:10, backgroundColor:'#000', borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center' },
  attachRemoveText:{ color:'#fff', fontSize:14, fontWeight:'700', marginTop:-2 },

  // Attach (+) button + action sheet
  attachBtn:     { width:38, height:38, borderRadius:10, backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center', flexShrink:0 },
  attachBtnText: { color:C.teal, fontSize:22, fontWeight:'600', marginTop:-2 },
  attachAction:  { flexDirection:'row', alignItems:'center', gap:14, paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border },
  attachActionIcon: { fontSize:22, width:30, textAlign:'center' },
  attachActionName: { fontSize:15, color:C.text, fontWeight:'500' },
})
