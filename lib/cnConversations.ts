// 大陆版手机端 · 本地多会话管理(cn 分支)
// 存储按手机号命名空间(国际版 2026-08-31 串号事故教训:同机换账号登录,
// 后来者会把前面人的本地会话"捡"进自己名下 —— 这里键随账号走,且登出即弃)。
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CnMessage } from './cnApi'

export type CnConversation = {
  id: string
  title: string
  model: string
  messages: CnMessage[]
  updatedAt: number
}

const key = (phone: string) => `cn_convs:${phone}`
const MAX_CONVERSATIONS = 50
const TITLE_LEN = 24

export function createConversationId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > TITLE_LEN ? t.slice(0, TITLE_LEN) + '…' : t
}

export async function loadConversations(phone: string): Promise<CnConversation[]> {
  try {
    const raw = await AsyncStorage.getItem(key(phone))
    if (!raw) return []
    const list = JSON.parse(raw) as CnConversation[]
    if (!Array.isArray(list)) return []
    return list
      .filter((c) => c && c.id && Array.isArray(c.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS)
  } catch {
    return []
  }
}

export async function saveConversations(phone: string, list: CnConversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key(phone), JSON.stringify(list.slice(0, MAX_CONVERSATIONS)))
  } catch {}
}

/** 追加或更新一条会话(按 id upsert),并按更新时间重排。 */
export async function upsertConversation(phone: string, conv: CnConversation): Promise<CnConversation[]> {
  const list = await loadConversations(phone)
  const idx = list.findIndex((c) => c.id === conv.id)
  const next = idx >= 0 ? list.map((c, i) => (i === idx ? conv : c)) : [conv, ...list]
  const sorted = next.sort((a, b) => b.updatedAt - a.updatedAt)
  await saveConversations(phone, sorted)
  return sorted
}

export async function dropConversation(phone: string, id: string): Promise<CnConversation[]> {
  const list = (await loadConversations(phone)).filter((c) => c.id !== id)
  await saveConversations(phone, list)
  return list
}

/** 登出弃本地会话(大陆版口径:会话仅存本机,登出=清空,不留给下一账号)。 */
export async function wipeConversations(phone: string): Promise<void> {
  try { await AsyncStorage.removeItem(key(phone)) } catch {}
}
