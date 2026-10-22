// 大陆版手机端 · work 协议客户端(CN10,2026-10-20)
// 对话底座新版协议:信封(protocolVersion=1 + requestId)、幂等重试(网络类失败
// 重发同一 clientRequestId,服务端幂等键去重)、变更流追赶与断档重建信号。
// 对齐 site/work/api.js(同一契约);令牌由宿主注入 getToken,本模块不保管。
import { CN_BASE } from './cnApi'

export const WORK_PROTOCOL_VERSION = 1

export class WorkApiError extends Error {
  code: string
  status?: number
  newestSeq?: number
  constructor(code: string, message: string, status?: number, newestSeq?: number) {
    super(message)
    this.name = 'WorkApiError'
    this.code = code
    this.status = status
    this.newestSeq = newestSeq
  }
}

export function genId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  return (prefix || '') + rnd
}

export type WorkCallResult = { __notOk?: boolean; status?: number; code?: string; error?: string; requestId?: string } & Record<string, unknown>

export type WorkApiOptions = { endpoint?: string; getToken: () => string | Promise<string> }

export type WorkClient = {
  call: (action: string, params?: Record<string, unknown>) => Promise<WorkCallResult>
  pullChanges: (cursor: number, pageSize?: number) => Promise<{ changes: unknown[]; newestSeq: number }>
  threadCreate: (p: Record<string, unknown>) => Promise<WorkCallResult>
  threadList: (p: Record<string, unknown>) => Promise<WorkCallResult>
  threadUpdate: (p: Record<string, unknown>) => Promise<WorkCallResult>
  threadDelete: (p: Record<string, unknown>) => Promise<WorkCallResult>
  messageList: (p: Record<string, unknown>) => Promise<WorkCallResult>
  messageAppend: (p: Record<string, unknown>) => Promise<WorkCallResult>
  commandsList: (p: Record<string, unknown>) => Promise<WorkCallResult>
  toolInvoke: (p: Record<string, unknown>) => Promise<WorkCallResult>
  runGet: (p: Record<string, unknown>) => Promise<WorkCallResult>
  legacyImport: (phase: string) => Promise<WorkCallResult>
  genId: (prefix: string) => string
}

export function createWorkApi(opts: WorkApiOptions): WorkClient {
  const endpoint = opts.endpoint || CN_BASE + '/crm-api'   // 与网页同域,无跨域
  const getToken = opts.getToken

  // 底层请求:一次网络级重试(同 requestId 同 clientRequestId——幂等由服务端兜底)
  async function post(body: Record<string, unknown>, allowRetry: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      if (allowRetry) return post(body, false)   // 断网/瞬时失败:原样重发一次
      throw new WorkApiError('NETWORK', '网络请求失败:' + String((e as Error).message).slice(0, 80))
    }
    let j: Record<string, unknown> | null = null
    try { j = await res.json() as Record<string, unknown> } catch { j = null }
    if (!j) throw new WorkApiError('BAD_RESPONSE', '响应不是 JSON(HTTP ' + res.status + ')', res.status)
    if (res.status === 401) throw new WorkApiError(String(j.code || 'UNAUTHENTICATED'), String(j.error || '未登录'), 401)
    return { status: res.status, body: j }
  }

  // 业务失败(非 2xx)不抛异常:返回 {__notOk, status, code, error} 由宿主处理
  async function call(action: string, params?: Record<string, unknown>): Promise<WorkCallResult> {
    const body: Record<string, unknown> = { ...(params || {}) }
    body.action = action
    body.protocolVersion = WORK_PROTOCOL_VERSION
    body.requestId = (body.requestId as string) || genId('rq-')
    body.session_token = await getToken()
    const r = await post(body, true)
    if (r.status >= 200 && r.status < 300) return r.body as WorkCallResult
    return { __notOk: true, status: r.status, code: r.body.code as string, error: r.body.error as string, requestId: r.body.requestId as string }
  }

  // 变更流追赶:翻页到尽头;断档抛 SYNC_EXPIRED(携 newestSeq)——宿主改走快照重建
  async function pullChanges(cursor: number, pageSize = 100): Promise<{ changes: unknown[]; newestSeq: number }> {
    const all: unknown[] = []
    let cur = cursor || 0
    for (let guard = 0; guard < 100; guard++) {
      const b = await call('work_changes', { cursor: cur, limit: pageSize })
      if (b.__notOk) {
        if (b.code === 'SYNC_EXPIRED') throw new WorkApiError('SYNC_EXPIRED', '变更流断档,需快照重建')
        throw new WorkApiError(b.code || 'CHANGES_FAILED', b.error || '拉取失败', b.status)
      }
      if (b.syncExpired) throw new WorkApiError('SYNC_EXPIRED', '变更流断档,需快照重建', undefined, Number(b.newestSeq) || undefined)
      all.push(...((b.changes as unknown[]) || []))
      if (!b.nextCursor) return { changes: all, newestSeq: Number(b.newestSeq) || 0 }
      cur = Number(b.nextCursor)
    }
    throw new WorkApiError('SYNC_LOOP', '变更流翻页超限(疑似异常数据)')
  }

  // 类型化便捷方法:幂等类操作缺省自动生成 clientRequestId(重试安全)
  const withId = (p: Record<string, unknown>, prefix: string) => {
    const q = { ...p }
    q.clientRequestId = (q.clientRequestId as string) || genId(prefix)
    return q
  }
  return {
    call,
    pullChanges,
    threadCreate: (p) => call('work_thread_create', withId(p, 'tc-')),
    threadList: (p) => call('work_thread_list', p),
    threadUpdate: (p) => call('work_thread_update', p),
    threadDelete: (p) => call('work_thread_delete', p),
    messageList: (p) => call('work_message_list', p),
    messageAppend: (p) => call('work_message_append', withId(p, 'ma-')),
    commandsList: (p) => call('work_commands_list', p),
    toolInvoke: (p) => call('work_tool_invoke', withId(p, 'inv-')),
    runGet: (p) => call('work_run_get', p),
    legacyImport: (phase) => call('work_legacy_import', { phase }),
    genId,
  }
}
