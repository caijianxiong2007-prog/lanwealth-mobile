import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import type { ContentPart, Message } from './api'

export type MobileConversation = {
  id: string
  title: string
  model: string
  messages: Message[]
  updatedAt: number
}

// ── 本地仓必须按用户命名空间 ────────────────────────────────────────────────
// 2026-08-31 真实事故:老板在客户公司电脑上用网页版演示,浏览器本地仓留下他的会话;
// 客户在同一台机器注册登录后,客户端把那份列表整包同步上云 —— 18 条含第三方
// (中崛公司、长信化学)经营数据的会话落进了客户账号。
// 手机端这里是**同一个病**,而且更重:登出只调 auth.signOut() 不清本地,
// 且 app/_layout.tsx 会在无 session 时自动建匿名号 —— 一台演示机轮流登几个账号,
// 每个后来者都会把前面所有人的会话写进自己名下。
//
// ⚠️ 旧的全局键分**两档**,待遇不同,别搞混:
//  · `mobile_conversations_v2` / `mobile_active_conversation_v2`(2026-06-20 与云同步同批引入)
//    —— 内容云端全量都有,**不读、直接删**。留着只会被下一个登录的人捡走。
//  · `mobile_messages` / `conv_title`(2026-05-28,**早于云同步三周**)
//    —— 只存在本机、**删了找不回**,所以**不读也不删**,让它当孤儿留在盘上。
//    读它=把它交给当前登录的人(按错主人),删它=永久销毁。两样都不做。
//    与网页端对 IndexedDB `bayze_secret` 的处置同构。
const LEGACY_STORAGE_KEY = 'mobile_conversations_v2'
const LEGACY_ACTIVE_KEY  = 'mobile_active_conversation_v2'
/** 只存本机、早于云同步(2026-05-28,比 saveCloudConversation 早三周)的旧键。
 *  **代码绝不读、也绝不删** —— 读=按错主人交给当前登录者,删=永久销毁。
 *  导出仅供将来的「旧会话认领」工具定位残留数据。 */
export const LEGACY_LOCAL_ONLY_KEYS = ['mobile_messages', 'conv_title'] as const

const storageKey = (userId: string) => `mobile_conversations_v2:${userId}`
const activeKey  = (userId: string) => `mobile_active_conversation_v2:${userId}`
const MAX_CONVERSATIONS = 80
const MAX_CLOUD_MSG_CHARS = 100_000

function normalizeContent(value: unknown): string | ContentPart[] {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: ContentPart[] = []
  for (const part of value) {
    if (!part || typeof part !== 'object') continue
    const p = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } }
    if (p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text })
    if (p.type === 'image_url' && typeof p.image_url?.url === 'string') {
      parts.push({ type: 'image_url', image_url: { url: p.image_url.url } })
    }
  }
  return parts
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return []
  const messages: Message[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as { role?: unknown; content?: unknown }
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue
    messages.push({ role: m.role, content: normalizeContent(m.content) })
  }
  return messages.slice(0, 200)
}

function normalizeConversation(raw: unknown): MobileConversation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as { id?: unknown; title?: unknown; model?: unknown; messages?: unknown; updatedAt?: unknown; updated_at?: unknown }
  if (typeof c.id !== 'string' || !c.id) return null
  const remoteUpdated = typeof c.updated_at === 'string' ? Date.parse(c.updated_at) : NaN
  const updatedAt = typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt)
    ? c.updatedAt
    : (Number.isFinite(remoteUpdated) ? remoteUpdated : Date.now())
  return {
    id: c.id,
    title: typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 160) : 'New chat',
    model: typeof c.model === 'string' && c.model ? c.model : 'deepseek-v4-flash',
    messages: normalizeMessages(c.messages),
    updatedAt,
  }
}

export function createConversationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function mergeConversations(local: MobileConversation[], cloud: MobileConversation[]) {
  const merged = new Map<string, MobileConversation>()
  for (const conversation of [...local, ...cloud]) {
    const current = merged.get(conversation.id)
    // Local wins on an exact tie because it can retain full image data URLs.
    if (!current || conversation.updatedAt > current.updatedAt) merged.set(conversation.id, conversation)
  }
  return Array.from(merged.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
}

/** 清掉迁移前的全局本地仓。内容云端全量都有,删了不丢;留着会被下一个登录的人捡走。 */
export async function dropLegacyLocalStore(): Promise<void> {
  // 故意不先 getItem 判存在 —— multiRemove 对不存在的键本就是空操作,
  // 而「绝不读旧键」是这次修复的红线(读了就可能顺手用上 = 按错主人搬运)。
  await AsyncStorage.multiRemove([LEGACY_STORAGE_KEY, LEGACY_ACTIVE_KEY]).catch(() => undefined)
}

/** ⚠️ 必须传当前登录用户的 id。**拿不到 userId 就别读本地仓** ——
 *  宁可显示空(云端会同步回来),也不能把上一个用户的会话端给现在这个人。 */
export async function loadLocalConversations(userId: string): Promise<{ conversations: MobileConversation[]; activeId: string | null }> {
  if (!userId) return { conversations: [], activeId: null }
  const [stored, activeId] = await Promise.all([
    AsyncStorage.getItem(storageKey(userId)),
    AsyncStorage.getItem(activeKey(userId)),
  ])

  let conversations: MobileConversation[] = []
  try {
    const parsed = JSON.parse(stored ?? '[]')
    if (Array.isArray(parsed)) conversations = parsed.map(normalizeConversation).filter((c): c is MobileConversation => Boolean(c))
  } catch { /* 本地仓损坏就当空的:云端会同步回来 */ }

  return {
    conversations: conversations.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS),
    activeId: activeId && conversations.some(c => c.id === activeId) ? activeId : conversations[0]?.id ?? null,
  }
}

/** ⚠️ 必须传当前登录用户的 id。拿不到就**不落盘** —— 否则又写出一份不知归属的数据。 */
export async function saveLocalConversations(userId: string, conversations: MobileConversation[], activeId: string | null) {
  if (!userId) return
  // Base64 image payloads can exceed AsyncStorage limits after only a few chats.
  // Keep them in memory for the current session, but persist a compact marker.
  const limited = conversations.slice(0, MAX_CONVERSATIONS).map(conversationForStorage)
  await AsyncStorage.multiSet([
    [storageKey(userId), JSON.stringify(limited)],
    [activeKey(userId), activeId ?? ''],
  ])
}

export async function fetchCloudConversations(userId: string): Promise<{ conversations: MobileConversation[]; deletedIds: string[] }> {
  const [active, deleted] = await Promise.all([
    supabase
      .from('chat_conversations')
      .select('id, title, model, messages, updated_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(MAX_CONVERSATIONS),
    supabase
      .from('chat_conversations')
      .select('id')
      .eq('user_id', userId)
      .not('deleted_at', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(500),
  ])
  if (active.error) throw active.error
  if (deleted.error) throw deleted.error
  return {
    conversations: (active.data ?? []).map(normalizeConversation).filter((c): c is MobileConversation => Boolean(c)),
    deletedIds: (deleted.data ?? []).flatMap(row => typeof row.id === 'string' ? [row.id] : []),
  }
}

function contentForCloud(content: string | ContentPart[]): string | ContentPart[] {
  if (typeof content === 'string') return content.slice(0, MAX_CLOUD_MSG_CHARS)
  return content.map(part => {
    if (part.type === 'image_url' && part.image_url.url.startsWith('data:')) {
      return { type: 'text' as const, text: '[image]' }
    }
    if (part.type === 'text') return { ...part, text: part.text.slice(0, MAX_CLOUD_MSG_CHARS) }
    return part
  })
}

function conversationForStorage(conversation: MobileConversation): MobileConversation {
  return {
    ...conversation,
    messages: conversation.messages.slice(-200).map(message => ({
      ...message,
      content: contentForCloud(message.content),
    })),
  }
}

function cloudRow(userId: string, conversation: MobileConversation) {
  return {
    user_id: userId,
    id: conversation.id,
    title: conversation.title.slice(0, 160),
    model: conversation.model,
    messages: conversation.messages.slice(0, 200).map(m => ({ ...m, content: contentForCloud(m.content) })),
    updated_at: new Date(conversation.updatedAt).toISOString(),
    deleted_at: null,
  }
}

export async function saveCloudConversation(userId: string, conversation: MobileConversation) {
  const { data: existing, error: existingError } = await supabase
    .from('chat_conversations')
    .select('deleted_at')
    .eq('user_id', userId)
    .eq('id', conversation.id)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.deleted_at) return

  const { error } = await supabase.from('chat_conversations').upsert(cloudRow(userId, conversation), { onConflict: 'user_id,id' })
  if (error) throw error
}

export async function saveCloudConversations(userId: string, conversations: MobileConversation[]) {
  if (!conversations.length) return
  const candidates = conversations.slice(0, MAX_CONVERSATIONS)
  const { data: existing, error: existingError } = await supabase
    .from('chat_conversations')
    .select('id, deleted_at')
    .eq('user_id', userId)
    .in('id', candidates.map(c => c.id))
  if (existingError) throw existingError
  const deleted = new Set((existing ?? []).filter(row => row.deleted_at).map(row => row.id))
  const rows = candidates.filter(c => !deleted.has(c.id)).map(c => cloudRow(userId, c))
  if (!rows.length) return
  const { error } = await supabase.from('chat_conversations').upsert(
    rows,
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

export async function deleteCloudConversation(userId: string, id: string) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('chat_conversations').upsert({
    user_id: userId,
    id,
    updated_at: now,
    deleted_at: now,
  }, { onConflict: 'user_id,id' })
  if (error) throw error
}
