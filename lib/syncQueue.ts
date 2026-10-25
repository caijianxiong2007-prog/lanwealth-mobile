// 国际版手机端 · work 同步引擎与待发队列(INT10,2026-10-25)
// 与大陆版 syncQueue.ts 同一契约:
//   - 快照重建:thread_list 翻页取全 → 存快照;游标从当前水位续拉一次(断档校正);
//   - 增量追赶:changes → 墓碑/标脏/推进本地 revision;
//   - 发送:入队即试发;409 冲突出队不盲目重试;网络失败留队(幂等键固定,
//     服务端去重——"响应丢了但已写入"与"确实没发出"两种歧义都被消解);
//   - 国际版差异:企业空间参数为 orgId(大陆为 tenantId);REST 分发在 workApi 内。
import { WorkApiError, genId } from './workApi'
import type { WorkClient } from './workApi'
import type { WorkStore, WorkMessagePart } from './workStore'

export type SyncOptions = { api: WorkClient; store: WorkStore; scope: 'personal' | 'enterprise'; orgId?: string | null }

export type SendResult = {
  messageId?: string; seq?: number; revision?: number; dedup?: boolean
  conflict?: boolean; queued?: boolean; dropped?: boolean; error?: string; code?: string
}

export function createWorkSync(opts: SyncOptions) {
  const { api, store, scope } = opts
  const orgId = opts.orgId || null

  function listParams(extra?: Record<string, unknown>): Record<string, unknown> {
    const p: Record<string, unknown> = { scope }
    if (scope === 'enterprise') p.orgId = String(orgId)
    return { ...p, ...(extra || {}) }
  }

  /** 快照重建:翻页取全 + 存快照;断档安全水位校正 */
  async function rebuild(): Promise<number> {
    const items: unknown[] = []
    let cursor = ''
    for (let guard = 0; guard < 100; guard++) {
      const page = await api.threadList(listParams(cursor ? { cursor, limit: 100 } : { limit: 100 }))
      if (page.__notOk) throw new Error('快照拉取失败:' + (page.error || page.code))
      items.push(...((page.items as unknown[]) || []))
      if (!page.nextCursor) break
      cursor = String(page.nextCursor)
    }
    await store.saveSnapshot(items as never)
    try {
      const r = await api.pullChanges(await store.getCursor())
      await store.setCursor(r.newestSeq)
    } catch (e) {
      if (e instanceof WorkApiError && e.code === 'SYNC_EXPIRED' && typeof e.newestSeq === 'number') await store.setCursor(e.newestSeq)
      else throw e
    }
    return items.length
  }

  /** 增量追赶:返回 {applied, deleted, expired}(expired=断档,调用方应 rebuild) */
  async function poll(): Promise<{ applied: number; deleted: number; expired: boolean }> {
    let applied = 0, deleted = 0
    try {
      const r = await api.pullChanges(await store.getCursor())
      await store.setCursor(r.newestSeq)
      for (const evRaw of r.changes) {
        const ev = evRaw as { threadId: string; op: string; revision?: number }
        if (ev.op === 'thread_deleted') { await store.removeThread(ev.threadId); deleted++; continue }
        if (ev.op === 'message_appended' || ev.op === 'thread_updated' || ev.op === 'member_revoked' || ev.op === 'visibility_changed') {
          await store.markDirty(ev.threadId, ev.op)
          const th = await store.getThread(ev.threadId)
          if (th && typeof ev.revision === 'number' && ev.revision > th.revision) {
            th.revision = ev.revision
            await store.upsertThread(th)
          }
          applied++
        }
      }
      return { applied, deleted, expired: false }
    } catch (e) {
      if (e instanceof WorkApiError && e.code === 'SYNC_EXPIRED') return { applied, deleted, expired: true }
      throw e
    }
  }

  /** 拉取单个会话的消息(打开会话时;按 seq 升序) */
  async function loadMessages(threadId: string): Promise<{ items: unknown[]; __notOk?: boolean; error?: string }> {
    const r = await api.messageList({ threadId, afterSeq: 0, limit: 200 })
    if (r.__notOk) return { items: [], __notOk: true, error: r.error }
    const items = (r.items as unknown[]) || []
    await store.setMessages(threadId, items as never)
    return { items }
  }

  /** 发送:入队 → 立即试发;结果见 SendResult */
  async function send(threadId: string, parts: WorkMessagePart[], expectedRevision: number): Promise<SendResult> {
    const pending = await store.getPending()
    const item = { clientRequestId: genId('ma-'), threadId, parts, expectedRevision, queuedAt: Date.now() }
    pending.push(item)
    await store.setPending(pending)
    const results = await flush()
    return results[results.length - 1] || { error: 'QUEUE_EMPTY' }
  }

  /** 冲水:成功/冲突出队;网络异常与 5xx 留队;确定性失败(400/403/404)出队如实上报 */
  async function flush(): Promise<SendResult[]> {
    const pending = await store.getPending()
    const results: SendResult[] = []
    const keep: typeof pending = []
    for (const it of pending) {
      let r
      try {
        r = await api.messageAppend({
          threadId: it.threadId, parts: it.parts,
          expectedRevision: it.expectedRevision, clientRequestId: it.clientRequestId,
        })
      } catch (e) {
        results.push({ queued: true, error: String((e as Error).message).slice(0, 80) })
        keep.push(it)
        continue
      }
      if (r.__notOk) {
        if (r.code === 'REVISION_CONFLICT') { results.push({ conflict: true, error: r.error }); continue }
        if ((r.status || 0) >= 500 || r.code === 'NETWORK') { results.push({ queued: true, error: r.error }); keep.push(it); continue }
        results.push({ dropped: true, error: r.error, code: r.code })
        continue
      }
      results.push({
        messageId: r.messageId as string, seq: r.seq as number,
        revision: r.revision as number, dedup: !!r.dedup,
      })
    }
    await store.setPending(keep)
    return results
  }

  return { rebuild, poll, loadMessages, send, flush, listParams }
}
