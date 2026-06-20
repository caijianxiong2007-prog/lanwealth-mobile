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

const STORAGE_KEY = 'mobile_conversations_v2'
const ACTIVE_KEY = 'mobile_active_conversation_v2'
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

export async function loadLocalConversations(): Promise<{ conversations: MobileConversation[]; activeId: string | null }> {
  const [stored, activeId, legacyMessages, legacyTitle] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEY),
    AsyncStorage.getItem(ACTIVE_KEY),
    AsyncStorage.getItem('mobile_messages'),
    AsyncStorage.getItem('conv_title'),
  ])

  let conversations: MobileConversation[] = []
  try {
    const parsed = JSON.parse(stored ?? '[]')
    if (Array.isArray(parsed)) conversations = parsed.map(normalizeConversation).filter((c): c is MobileConversation => Boolean(c))
  } catch { /* start with the legacy record */ }

  if (!conversations.length && legacyMessages) {
    try {
      const messages = normalizeMessages(JSON.parse(legacyMessages))
      if (messages.length) {
        const migrated: MobileConversation = {
          id: createConversationId(),
          title: legacyTitle?.trim() || 'Previous chat',
          model: 'deepseek-v4-flash',
          messages,
          updatedAt: Date.now(),
        }
        conversations = [migrated]
        await saveLocalConversations(conversations, migrated.id)
        await AsyncStorage.multiRemove(['mobile_messages', 'conv_title'])
      }
    } catch { /* ignore malformed legacy cache */ }
  }

  return {
    conversations: conversations.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS),
    activeId: activeId && conversations.some(c => c.id === activeId) ? activeId : conversations[0]?.id ?? null,
  }
}

export async function saveLocalConversations(conversations: MobileConversation[], activeId: string | null) {
  // Base64 image payloads can exceed AsyncStorage limits after only a few chats.
  // Keep them in memory for the current session, but persist a compact marker.
  const limited = conversations.slice(0, MAX_CONVERSATIONS).map(conversationForStorage)
  await AsyncStorage.multiSet([
    [STORAGE_KEY, JSON.stringify(limited)],
    [ACTIVE_KEY, activeId ?? ''],
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
