// 大陆版测试 · work 协议三模块(CN10):信封/幂等重试/串号守卫/离线队列/断档重建
// 源码断言风格与 cn-isolation.test.mjs 同族(模块为 TS,运行时由 Expo 打包;
// 契约行为已由主仓 work-e2e 131 项覆盖,此处守卫结构与红线)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const api = read('lib/workApi.ts')
const store = read('lib/workStore.ts')
const sync = read('lib/syncQueue.ts')

test('workApi 信封:protocolVersion=1 与 requestId 必填生成', () => {
  assert.match(api, /WORK_PROTOCOL_VERSION = 1/)
  assert.match(api, /body\.protocolVersion = WORK_PROTOCOL_VERSION/)
  assert.match(api, /body\.requestId = \(body\.requestId as string\) \|\| genId\('rq-'\)/)
})

test('workApi 网络重试原样重发(同 requestId/clientRequestId,幂等由服务端兜底)', () => {
  assert.match(api, /if \(allowRetry\) return post\(body, false\)/)
  assert.match(api, /q\.clientRequestId = \(q\.clientRequestId as string\) \|\| genId\(prefix\)/)
})

test('workApi 401 抛 WorkApiError 供宿主跳登录;业务失败不抛返回 __notOk', () => {
  assert.match(api, /res\.status === 401\) throw new WorkApiError/)
  assert.match(api, /__notOk: true/)
})

test('workApi 断档信号:SYNC_EXPIRED 携 newestSeq(快照重建依据)', () => {
  assert.match(api, /SYNC_EXPIRED/)
  assert.match(api, /b\.syncExpired\) throw new WorkApiError\('SYNC_EXPIRED'/)
  assert.match(api, /newestSeq/)
})

test('workStore 键按手机号+空间命名空间(不落全局键;承接串号事故守卫)', () => {
  assert.match(store, /const K = baseKey\(phone, scope, tenantId\)/)
  assert.match(store, /SCHEMA\}:\$\{phone\}:\$\{space\}/)   // 键=版本:手机号:空间
  // 全局裸键(无手机号前缀)即串号事故形态
  assert.doesNotMatch(store, /AsyncStorage\.(getItem|setItem)\(\s*['"]lw-work/)
})

test('workStore 以 phone 为第一参(无账号不落盘不读取)', () => {
  assert.match(store, /function createWorkStore\(phone: string, scope/)
  assert.match(store, /export async function wipeWorkStore\(phone: string\)/)
})

test('workStore 登出即弃 + 墓碑语义(删除不复活旧缓存)', () => {
  assert.match(store, /await AsyncStorage\.removeItem\(k \+ ':threads'\)/)
  assert.match(store, /墓碑/)
})

test('workStore 服务器序号事实来源:游标与快照分层', () => {
  assert.match(store, /getCursor/)
  assert.match(store, /setCursor/)
  assert.match(store, /saveSnapshot/)
})

test('syncQueue 冲突不盲目重试(409 出队),网络异常留队', () => {
  assert.match(sync, /REVISION_CONFLICT'\) \{ results\.push\(\{ conflict: true/)
  assert.match(sync, />= 500 \|\| r\.code === 'NETWORK'\) \{ results\.push\(\{ queued: true/)
  assert.match(sync, /keep\.push\(it\)/)
})

test('syncQueue 增量追赶推进本地 revision(防旧 revision 提交)+ 断档上报', () => {
  assert.match(sync, /ev\.revision > th\.revision/)
  assert.match(sync, /expired: true/)
  assert.match(sync, /store\.removeThread\(ev\.threadId\)/)
})

test('syncQueue 快照重建后从水位续拉(断档安全)', () => {
  assert.match(sync, /pullChanges\(await store\.getCursor\(\)\)/)
  assert.match(sync, /e\.code === 'SYNC_EXPIRED' && typeof e\.newestSeq === 'number'\) await store\.setCursor\(e\.newestSeq\)/)
})

test('三模块零新原生依赖(仅 AsyncStorage,与仓内既有栈一致)', () => {
  for (const src of [api, store, sync]) {
    assert.doesNotMatch(src, /require\(['"]react-native-fs/)
    assert.doesNotMatch(src, /from ['"]expo-file-system/)
  }
})
