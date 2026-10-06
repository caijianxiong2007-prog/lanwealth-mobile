// 大陆版手机端 · 本地多会话管理(cn 分支)
// 存储按手机号命名空间(国际版 2026-08-31 串号事故教训:同机换账号登录,
// 后来者会把前面人的本地会话"捡"进自己名下 —— 这里键随账号走,且登出即弃)。
import AsyncStorage from '@react-native-async-storage/async-storage'

// 本地会话仅存纯文本(图片等二进制不落本地仓;多模态只在发送时组装)
export type CnConversation = {
  id: string
  title: string
  model: string
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
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

// ── 会话云同步(2026-10-07)───────────────────────────────────────────────────
// 口径:本地仓(AsyncStorage)始终为主存,云端为同步副本。拉取=合并(updatedAt 新者
// 胜,云端缺的本地条目回推);上推=单会话 upsert。全部尽力而为:断网/失败静默。
// 保密红线:手机端当前无保密会话;若未来加,id 以 secret- 前缀的条目在此层跳过
// (服务端 conversations_cn 无 secret 列 + conv_upsert 硬拒,双保险)。
import { cnConvList, cnConvUpsert, cnConvDelete, CnCloudConv } from './cnApi'

function fromCloud(rc: CnCloudConv): CnConversation {
  return {
    id: rc.conv_id,
    title: (rc.title || '').slice(0, TITLE_LEN),
    model: rc.model || 'bayze-auto',
    messages: rc.messages.filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant')),
    updatedAt: rc.updated_at,
  }
}

/** 登录后拉云端合并进本地(返回合并后列表);顺带把本地独有条目补推上云。 */
export async function syncPullConversations(phone: string): Promise<CnConversation[]> {
  let list = await loadConversations(phone)
  try {
    const cloud = await cnConvList()
    const byId = new Map(list.map(c => [c.id, c]))
    let changed = false
    for (const rc of cloud) {
      if (!rc.conv_id || rc.conv_id.startsWith('secret-')) continue   // 保密红线:云端不该有,有也不认
      const conv = fromCloud(rc)
      if (!conv.messages.length) continue
      const local = byId.get(conv.id)
      if (!local) { list = [conv, ...list]; byId.set(conv.id, conv); changed = true }
      else if (conv.updatedAt > local.updatedAt) {
        local.messages = conv.messages; local.updatedAt = conv.updatedAt
        if (conv.title) local.title = conv.title
        changed = true
      }
    }
    if (changed) await saveConversations(phone, list)
    // 本地独有(含首次上线的存量)补推
    const cloudIds = new Set(cloud.map(rc => rc.conv_id))
    for (const c of list) {
      if (!c.id.startsWith('secret-') && c.messages.length && !cloudIds.has(c.id)) void cnConvUpsert(c)
    }
  } catch {}
  return list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS)
}

/** 本地落库后异步上推单会话(调用方不用 await,尽力而为)。 */
export function syncPushConversation(conv: CnConversation): void {
  if (!conv.id || conv.id.startsWith('secret-') || !conv.messages.length) return
  void cnConvUpsert(conv)
}

/** 删除会话同步上云(软删)。 */
export function syncDeleteConversation(id: string): void {
  if (id.startsWith('secret-')) return
  void cnConvDelete(id)
}
