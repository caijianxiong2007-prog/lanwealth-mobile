// ── 国际版手机端 · work 协议三模块源码守卫(INT10,2026-10-25) ────────────────
// 走源码文本(浏览器/RN 模块在 node 里跑不起来;键位/分发/队列语义文本查得准)。
// 含跨仓契约核对:移动端 ROUTES 与 tokenbridge 服务端 ROUTES 逐 action 对齐。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let failed = 0, passed = 0
const ok = (c, label, d = '') => {
  if (c) { passed++; return }
  failed++; console.error(`  ✗ ${label}${d ? ' — ' + d : ''}`)
}
const section = (t) => console.log(`\n${t}`)

for (const f of ['lib/workApi.ts', 'lib/workStore.ts', 'lib/syncQueue.ts']) {
  ok(existsSync(join(root, f)), `文件存在: ${f}`)
}
const A = read('lib/workApi.ts'), S = read('lib/workStore.ts'), Q = read('lib/syncQueue.ts')

// ═══ ⓪ UI 卡片与入口(INT10) ═══
section('⓪ WorkThreadsCard + Work Tab')
ok(existsSync(join(root, 'components/WorkThreadsCard.tsx')), '文件存在: components/WorkThreadsCard.tsx')
const W = existsSync(join(root, 'components/WorkThreadsCard.tsx')) ? read('components/WorkThreadsCard.tsx') : ''
ok(/getSession/.test(W) && /getToken: async \(\) => \(await getSession\(\)\)\?\.access_token/.test(W), '令牌每次现取(supabase 自动续期,1h 过期不卡死)')
ok(/createWorkStore\(s\.user\.id, 'personal', null\)/.test(W), '缓存键=userId(D 串号守卫)')
ok(/rememberSpace/.test(W), '登记空间索引(登出全清)')
ok(/ctx\.sync\.send\(/.test(W), '发送走同步队列(离线入队语义)')
ok(/r\.conflict/.test(W) && /open\(openThread\)/.test(W), '409 冲突→重读')
ok(/typeof r\.revision === 'number'/.test(W), 'revision 以服务端真值推进(回复桥 +1 兼容)')
ok(/sync\.loadMessages|ctx\.sync\.loadMessages/.test(W), '消息拉取走 loadMessages')
ok(/未登录|Not signed in/.test(W), '未登录提示态(不崩)')
ok(/sync\.rebuild\(\)/.test(W), '进入即快照重建(失败回落本地缓存)')
const LAYOUT = read('app/(tabs)/_layout.tsx')
ok(/name="work"/.test(LAYOUT), 'Tab 栏含 work 入口(与 Chat 并存灰度)')
ok(existsSync(join(root, 'app/(tabs)/work.tsx')), '文件存在: app/(tabs)/work.tsx')

// ═══ ① workApi:REST 分发与鉴权 ═══
section('① workApi · REST 分发 / Bearer / 多域名')
ok(/const ROUTES: Record<string, Route>/.test(A), 'ROUTES 路由表(REST 按 action 分发,非单入口)')
ok(/Authorization: `Bearer \$\{await getToken\(\)\}`/.test(A), '鉴权走 Bearer 头(令牌宿主注入,模块不保管)')
ok(/await resolveBase\(\)/.test(A), '基址经 resolveBase 多域名切换')
ok(/markBaseBad/.test(A), '网络失败标记基址换下一个')
ok(/if \(allowRetry\)/.test(A), '网络级失败原样重试一次(幂等键不变)')
ok(/WORK_PROTOCOL_VERSION = 1/.test(A), 'protocolVersion=1(契约对齐)')
ok(/res\.status === 401\) throw new WorkApiError/.test(A), '401 抛错(宿主跳登录)')
ok(/__notOk: true, status: r\.status, code/.test(A), '业务失败返回 __notOk 不抛')
ok(/未知 action/.test(A) && /needsThread && !p\.threadId/.test(A), '未知 action/缺 threadId 本地拒绝')
ok(/encodeURIComponent/.test(A), 'id 进 path 前编码')
ok(/toQuery\(p, \['threadId', 'action'\]\)/.test(A), 'GET 时 threadId 不重复进 query')
ok(/SYNC_EXPIRED/.test(A) && /newestSeq/.test(A), '断档抛 SYNC_EXPIRED 携水位')
ok(/withId\(p, 'tc-'\)/.test(A) && /withId\(p, 'ma-'\)/.test(A), '幂等操作自动生成 clientRequestId')
for (const act of ['work_thread_create', 'work_thread_list', 'work_thread_update', 'work_thread_delete', 'work_message_list', 'work_message_append', 'work_changes', 'work_tool_invoke', 'work_legacy_import', 'work_schedule_create', 'work_schedule_list', 'work_schedule_pause', 'work_schedule_resume', 'work_schedule_run_now', 'work_notifications_list', 'work_notifications_read', 'work_confirmation_list', 'work_confirmation_confirm']) {
  ok(new RegExp(act.replace(/_/g, '_') + ':').test(A), `ROUTES 含 ${act}`)
}

// ═══ ② 跨仓契约:与服务端 ROUTES 逐项对齐 ═══
section('② 跨仓契约 · 与 tokenbridge 服务端对齐')
const TB = join(root, '..', 'tokenbridge', 'src', 'lib', 'work', 'client.ts')
if (existsSync(TB)) {
  const tb = readFileSync(TB, 'utf8')
  const actions = [...A.matchAll(/^\s{2}(work_\w+):\s*\{/gm)].map((x) => x[1])
  for (const act of actions) {
    ok(new RegExp(`${act}:`).test(tb), `服务端 ROUTES 也有 ${act}`)
  }
  ok(actions.length === 18, `移动端 ROUTES 共 18 个 action`, `实际 ${actions.length}`)
  // 关键路径抽查:同 method 同 path 模板
  for (const [m, pathRe] of [
    ["work_message_append: { method: 'POST', path: (p) => `/api/work/threads/${enc(p.threadId)}/messages`", /work_message_append:\s*\{ method: 'POST', path: \(p\) => `\/api\/work\/threads\/\$\{enc\(p\.threadId\)\}\/messages`/],
  ]) { ok(pathRe.test(A), `路径模板: ${m.split(':')[0]}`) }
  ok(/work_confirmation_confirm/.test(tb) && /run-now/.test(tb), '服务端含确认单与 run-now 路由')
} else {
  ok(false, '找不到 ../tokenbridge/src/lib/work/client.ts(两仓须同级目录)')
}

// ═══ ③ workStore:userId 键与串号守卫 ═══
section('③ workStore · userId 键 / 不落盘守卫 / 墓碑')
ok(/tb-work-v1/.test(S), 'schema 版本前缀 tb-work-v1(与大陆 lw-work-v1 区分)')
ok(/function baseKey\(userId/.test(S), '键第一参=userId(Supabase UUID,非手机号)')
ok(/if \(!userId\) return\s+\/\/ 无账号不落盘/.test(S) || /无账号不落盘/.test(S), '无账号不落盘')
ok(/wipeWorkStore\(userId/.test(S), '登出即弃 wipeWorkStore(userId)')
ok(/__spaces/.test(S) && /rememberSpace/.test(S), '空间索引清单支撑全量清理')
ok(/墓碑/.test(S), '删除为墓碑语义')
ok(/getCursor|setCursor/.test(S) && /getPending|setPending/.test(S) && /getActiveRuns/.test(S), '游标/待发/运行缓存接口齐备')

// ═══ ④ syncQueue:重建/追赶/队列纪律 ═══
section('④ syncQueue · 重建 / 追赶 / 待发队列')
ok(/p\.orgId = String\(orgId\)/.test(Q), '企业空间参数=orgId(国际版口径,非 tenantId)')
ok(/快照重建/.test(Q) && /guard < 100/.test(Q), '快照翻页取全(护栏 100 页)')
ok(/SYNC_EXPIRED.*newestSeq/s.test(Q) || (Q.includes('SYNC_EXPIRED') && Q.includes('newestSeq')), '断档水位校正')
ok(/thread_deleted.*removeThread/s.test(Q), '墓碑事件→本地移除')
ok(/ev\.revision > th\.revision/.test(Q), '增量推进本地 revision(只前进)')
ok(/REVISION_CONFLICT.*conflict: true/s.test(Q), '409 冲突出队不盲目重试')
ok(/>= 500 \|\| r\.code === 'NETWORK'/.test(Q), '5xx/网络异常留队')
ok(/dropped: true/.test(Q), '确定性失败(4xx)出队如实上报')
ok(/clientRequestId: genId\('ma-'\)/.test(Q), '入队即固定幂等键')
ok(/loadMessages/.test(Q), '单会话消息拉取(打开会话用)')

console.log('\n' + '─'.repeat(60))
if (failed) { console.log(`❌ work-protocol: ${failed} 项失败 / ${passed} 项通过`); process.exit(1) }
console.log(`✅ work-protocol: ${passed} 项源码守卫全部通过`)
