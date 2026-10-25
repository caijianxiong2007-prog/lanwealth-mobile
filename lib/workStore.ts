// 国际版手机端 · work 本地缓存层(INT10,2026-10-25)
// 与大陆版 workStore.ts 同一契约,键维度从「手机号」换成「Supabase 用户 id」:
//   - 存储键 = 版本 + 用户 id + 空间(scope+orgId):账号/空间切换互不污染;
//   - 一切读写以 userId 为第一参——无账号不落盘不读取(承接串号事故守卫);
//   - 登出即弃:wipeWorkStore(userId) 清本人全部 work 缓存;
//   - 服务器序号是事实来源;快照只是初始视图,增量靠 changes 游标;删除是墓碑。
import AsyncStorage from '@react-native-async-storage/async-storage'

export type WorkThread = {
  threadId: string
  scope: 'personal' | 'enterprise'
  tenantId: string | null
  title: string
  revision: number
  updatedAt?: number
}

export type WorkMessagePart = { t: 'text'; v: string } | { t: string; id?: string; v?: string }

export type WorkMessage = {
  messageId: string
  threadId: string
  seq: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  parts: WorkMessagePart[]
}

export type PendingSend = {
  clientRequestId: string
  threadId: string
  parts: WorkMessagePart[]
  expectedRevision: number
  queuedAt: number
}

export type ActiveRun = { runId: string; toolId?: string; status?: string; cost?: number | null }

export type WorkStore = {
  scopeKey: string
  saveSnapshot: (items: WorkThread[]) => Promise<void>
  listThreads: () => Promise<WorkThread[]>
  getThread: (threadId: string) => Promise<WorkThread | null>
  upsertThread: (th: WorkThread) => Promise<void>
  removeThread: (threadId: string) => Promise<void>
  markDirty: (threadId: string, reason: string) => Promise<void>
  takeDirty: () => Promise<Record<string, { reason: string; at: number }>>
  getCursor: () => Promise<number>
  setCursor: (seq: number) => Promise<void>
  getMessages: (threadId: string) => Promise<WorkMessage[] | null>
  setMessages: (threadId: string, items: WorkMessage[]) => Promise<void>
  getPending: () => Promise<PendingSend[]>
  setPending: (list: PendingSend[]) => Promise<void>
  getActiveRuns: () => Promise<ActiveRun[]>
  setActiveRuns: (list: ActiveRun[]) => Promise<void>
}

const SCHEMA = 'tb-work-v1'

// 键随用户 id 走(国际版账号主键 = Supabase UUID;无账号即不落盘)
function baseKey(userId: string, scope: 'personal' | 'enterprise', orgId: string | null): string {
  const space = scope + (orgId == null || orgId === '' ? '' : ':' + orgId)
  return `${SCHEMA}:${userId}:${space}`
}

export function createWorkStore(userId: string, scope: 'personal' | 'enterprise', orgId: string | null): WorkStore {
  const K = baseKey(userId, scope, orgId)
  async function readJson<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(K + ':' + key)
      return raw == null ? fallback : (JSON.parse(raw) as T)
    } catch { return fallback }
  }
  async function writeJson(key: string, val: unknown): Promise<void> {
    if (!userId) return   // 无账号不落盘
    try { await AsyncStorage.setItem(K + ':' + key, JSON.stringify(val)) } catch { /* 配额满:缓存可丢,静默 */ }
  }

  return {
    scopeKey: K,
    async saveSnapshot(items) {
      const byId: Record<string, WorkThread> = {}
      const order: string[] = []
      for (const t of items) { byId[t.threadId] = t; order.push(t.threadId) }
      await writeJson('threads', { byId, order })
    },
    async listThreads() {
      const t = await readJson<{ byId: Record<string, WorkThread>; order: string[] }>('threads', { byId: {}, order: [] })
      return t.order.map((id) => t.byId[id]).filter(Boolean)
    },
    async getThread(threadId) {
      const t = await readJson<{ byId: Record<string, WorkThread> }>('threads', { byId: {} })
      return t.byId[threadId] || null
    },
    async upsertThread(th) {
      const t = await readJson<{ byId: Record<string, WorkThread>; order: string[] }>('threads', { byId: {}, order: [] })
      if (!t.byId[th.threadId]) t.order.unshift(th.threadId)
      t.byId[th.threadId] = th
      await writeJson('threads', t)
    },
    async removeThread(threadId) {   // 墓碑:本地移除;服务端仍有则快照重建再现,不复活旧缓存
      const t = await readJson<{ byId: Record<string, WorkThread>; order: string[] }>('threads', { byId: {}, order: [] })
      delete t.byId[threadId]
      const i = t.order.indexOf(threadId)
      if (i >= 0) t.order.splice(i, 1)
      await writeJson('threads', t)
    },
    async markDirty(threadId, reason) {
      const d = await readJson<Record<string, { reason: string; at: number }>>('dirty', {})
      d[threadId] = { reason, at: Date.now() }
      await writeJson('dirty', d)
    },
    async takeDirty() {
      const d = await readJson<Record<string, { reason: string; at: number }>>('dirty', {})
      await writeJson('dirty', {})
      return d
    },
    async getCursor() { return (await readJson<number>('cursor', 0)) || 0 },
    async setCursor(seq) { await writeJson('cursor', seq) },
    async getMessages(threadId) { return await readJson<WorkMessage[] | null>('msg:' + threadId, null) },
    async setMessages(threadId, items) { await writeJson('msg:' + threadId, items) },
    async getPending() { return await readJson<PendingSend[]>('pending', []) },
    async setPending(list) { await writeJson('pending', list) },
    async getActiveRuns() { return await readJson<ActiveRun[]>('runs', []) },
    async setActiveRuns(list) { await writeJson('runs', list) },
  }
}

// 登出即弃:清本人全部 work 缓存(所有空间)。AsyncStorage 无按前缀遍历,维护索引清单。
const INDEX_KEY = (userId: string) => `${SCHEMA}:${userId}:__spaces`
async function rememberSpace(userId: string, scopeKey: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId))
    const list: string[] = raw ? JSON.parse(raw) : []
    if (!list.includes(scopeKey)) { list.push(scopeKey); await AsyncStorage.setItem(INDEX_KEY(userId), JSON.stringify(list)) }
  } catch { /* 索引失败不阻断 */ }
}
export async function wipeWorkStore(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY(userId))
    const list: string[] = raw ? JSON.parse(raw) : []
    for (const k of list) await AsyncStorage.removeItem(k + ':threads')
    await AsyncStorage.removeItem(INDEX_KEY(userId))
  } catch { /* 清理失败静默;键随账号走,残留不会串号 */ }
}
export { rememberSpace }
