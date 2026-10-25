// 国际版手机端 · work 协议客户端(INT10,2026-10-25)
// 与 tokenbridge src/lib/work/client.ts 同一契约的 React Native 版:
//   - REST 按 action 分发(ROUTES 表:method+path),不是大陆版的单入口 POST;
//   - 鉴权走 Authorization: Bearer(workAuth 双通道的服务端一半),令牌由宿主
//     注入 getToken(通常 = supabase 会话 access_token),本模块不保管不刷新;
//   - 基址走 resolveBase() 多域名自动切换(大陆线路 TLS 阻断的既定对策),
//     网络级失败 markBaseBad 后原样重发一次(同 clientRequestId,幂等由服务端兜底);
//   - 信封(protocolVersion=1 + requestId);401 抛错(宿主跳登录);
//     业务失败不抛,返回 {__notOk}。
import { resolveBase, markBaseBad } from './baseUrl'

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

export type WorkApiOptions = { getToken: () => string | Promise<string> }

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Route = { method: HttpMethod; path: (p: Record<string, unknown>) => string; needsThread?: boolean }

// action → REST 路由(与 tokenbridge client.ts ROUTES 表同源;新增 schedules/notifications/confirmations)
const ROUTES: Record<string, Route> = {
  work_thread_create:  { method: 'POST', path: () => '/api/work/threads' },
  work_thread_list:    { method: 'GET',  path: () => '/api/work/threads' },
  work_thread_update:  { method: 'PATCH',  path: (p) => `/api/work/threads/${enc(p.threadId)}`, needsThread: true },
  work_thread_delete:  { method: 'DELETE', path: (p) => `/api/work/threads/${enc(p.threadId)}`, needsThread: true },
  work_message_list:   { method: 'GET',  path: (p) => `/api/work/threads/${enc(p.threadId)}/messages`, needsThread: true },
  work_message_append: { method: 'POST', path: (p) => `/api/work/threads/${enc(p.threadId)}/messages`, needsThread: true },
  work_changes:        { method: 'GET',  path: () => '/api/work/changes' },
  work_tool_invoke:    { method: 'POST', path: () => '/api/work/invoke' },
  work_legacy_import:  { method: 'POST', path: () => '/api/work/legacy-import' },
  work_schedule_create: { method: 'POST', path: () => '/api/work/schedules' },
  work_schedule_list:   { method: 'GET',  path: () => '/api/work/schedules' },
  work_schedule_pause:  { method: 'PATCH', path: (p) => `/api/work/schedules/${enc(p.scheduleId)}` },
  work_schedule_resume: { method: 'PATCH', path: (p) => `/api/work/schedules/${enc(p.scheduleId)}` },
  work_schedule_run_now: { method: 'POST', path: (p) => `/api/work/schedules/${enc(p.scheduleId)}/run-now` },
  work_notifications_list: { method: 'GET',  path: () => '/api/work/notifications' },
  work_notifications_read: { method: 'POST', path: () => '/api/work/notifications' },
  work_confirmation_list:  { method: 'GET',  path: () => '/api/work/confirmations' },
  work_confirmation_confirm: { method: 'POST', path: (p) => `/api/work/confirmations/${enc(p.confirmationId)}/confirm` },
}

function enc(v: unknown): string {
  return encodeURIComponent(String(v ?? ''))
}

function toQuery(params: Record<string, unknown>, omit: string[]): string {
  const q: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (omit.includes(k) || v === undefined || v === null || v === '') continue
    q.push(`${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`)
  }
  return q.length ? '?' + q.join('&') : ''
}

export type WorkClient = {
  call: (action: string, params?: Record<string, unknown>) => Promise<WorkCallResult>
  pullChanges: (cursor: number, pageSize?: number) => Promise<{ changes: unknown[]; newestSeq: number }>
  threadCreate: (p: Record<string, unknown>) => Promise<WorkCallResult>
  threadList: (p: Record<string, unknown>) => Promise<WorkCallResult>
  threadUpdate: (p: Record<string, unknown>) => Promise<WorkCallResult>
  threadDelete: (p: Record<string, unknown>) => Promise<WorkCallResult>
  messageList: (p: Record<string, unknown>) => Promise<WorkCallResult>
  messageAppend: (p: Record<string, unknown>) => Promise<WorkCallResult>
  toolInvoke: (p: Record<string, unknown>) => Promise<WorkCallResult>
  scheduleCreate: (p: Record<string, unknown>) => Promise<WorkCallResult>
  scheduleList: () => Promise<WorkCallResult>
  schedulePause: (p: Record<string, unknown>) => Promise<WorkCallResult>
  scheduleResume: (p: Record<string, unknown>) => Promise<WorkCallResult>
  scheduleRunNow: (p: Record<string, unknown>) => Promise<WorkCallResult>
  notificationsList: () => Promise<WorkCallResult>
  notificationsRead: (p: Record<string, unknown>) => Promise<WorkCallResult>
  confirmationsList: () => Promise<WorkCallResult>
  confirmationConfirm: (p: Record<string, unknown>) => Promise<WorkCallResult>
  legacyImport: (phase: string) => Promise<WorkCallResult>
  genId: (prefix: string) => string
}

export function createWorkApi(opts: WorkApiOptions): WorkClient {
  const getToken = opts.getToken

  // 底层请求:一次网络级重试(同 clientRequestId;域名失败切换基址)
  async function send(method: HttpMethod, path: string, body: Record<string, unknown> | null, allowRetry: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
    let res: Response
    try {
      const base = await resolveBase()
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${await getToken()}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      if (allowRetry) {
        await markBaseBad().catch(() => undefined)   // 当前基址可能被阻断:换下一个
        return send(method, path, body, false)
      }
      throw new WorkApiError('NETWORK', '网络请求失败:' + String((e as Error).message).slice(0, 80))
    }
    let j: Record<string, unknown> | null = null
    try { j = await res.json() as Record<string, unknown> } catch { j = null }
    if (!j) throw new WorkApiError('BAD_RESPONSE', '响应不是 JSON(HTTP ' + res.status + ')', res.status)
    if (res.status === 401) throw new WorkApiError(String(j.code || 'UNAUTHENTICATED'), String(j.error || '未登录'), 401)
    return { status: res.status, body: j }
  }

  // 业务失败(非 2xx)不抛异常:{__notOk, status, code, error} 由宿主处理
  async function call(action: string, params?: Record<string, unknown>): Promise<WorkCallResult> {
    const route = ROUTES[action]
    if (!route) return { __notOk: true, status: 400, code: 'VALIDATION', error: `未知 action: ${action}` }
    const p: Record<string, unknown> = { ...(params || {}) }
    if (route.needsThread && !p.threadId) return { __notOk: true, status: 400, code: 'VALIDATION', error: `${action} 需要 threadId` }
    p.protocolVersion = WORK_PROTOCOL_VERSION
    p.requestId = p.requestId || genId('rq-')

    const path = route.path(p)
    let r: { status: number; body: Record<string, unknown> }
    if (route.method === 'GET') {
      r = await send('GET', path + toQuery(p, ['threadId', 'action']), null, true)
    } else {
      const { threadId: _o, ...rest } = p
      void _o
      r = await send(route.method, path, rest, true)
    }
    if (r.status >= 200 && r.status < 300) return r.body as WorkCallResult
    const out: WorkCallResult = { __notOk: true, status: r.status, code: r.body.code as string, error: r.body.error as string, requestId: r.body.requestId as string }
    if (r.body.newestSeq !== undefined) out.newestSeq = r.body.newestSeq
    return out
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

  // 幂等类操作缺省自动生成 clientRequestId(重试安全)
  const withId = (p: Record<string, unknown>, prefix: string) => {
    const q = { ...p }
    q.clientRequestId = q.clientRequestId || genId(prefix)
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
    toolInvoke: (p) => call('work_tool_invoke', withId(p, 'ti-')),
    scheduleCreate: (p) => call('work_schedule_create', withId(p, 'sc-')),
    scheduleList: () => call('work_schedule_list'),
    schedulePause: (p) => call('work_schedule_pause', { ...p, action: 'pause' }),
    scheduleResume: (p) => call('work_schedule_resume', { ...p, action: 'resume' }),
    scheduleRunNow: (p) => call('work_schedule_run_now', withId(p, 'rn-')),
    notificationsList: () => call('work_notifications_list'),
    notificationsRead: (p) => call('work_notifications_read', withId(p, 'nr-')),
    confirmationsList: () => call('work_confirmation_list'),
    confirmationConfirm: (p) => call('work_confirmation_confirm', withId(p, 'cc-')),
    legacyImport: (phase) => call('work_legacy_import', { phase }),
    genId,
  }
}
