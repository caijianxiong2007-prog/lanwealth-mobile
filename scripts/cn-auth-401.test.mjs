// 大陆版测试 ③:统一 401 登出 + 退出登录顺序(P1-08/P0-01 回归守卫)
// 要求:401 → 清会话 → 单次跳登录;多在途请求并发 401 只处理一次;
// 退出登录:先清本机会话数据再跳页;useRouter 必须组件顶层调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const api = read('lib/cnApi.ts')
const layout = read('app/_layout.tsx')
const settings = read('app/(tabs)/settings.tsx')

test('post() 与 cnOcr() 都有 401 分支', () => {
  const branches = [...api.matchAll(/if \(res\.status === 401\)/g)]
  assert.ok(branches.length >= 2, `期望 ≥2 处 401 分支,实得 ${branches.length}`)
})

test('on401:先清会话,再调 handler;顺序不可倒', () => {
  const code = api.replace(/\/\/.*$/gm, '')
  const iClear = code.indexOf('await clearCnSession()')
  const iHandler = code.indexOf('unauthorizedHandler()')
  assert.ok(iClear > 0, 'on401 内找不到 clearCnSession()')
  assert.ok(iHandler > 0, 'on401 内找不到 unauthorizedHandler()')
  assert.ok(iClear < iHandler, '必须先清会话再跳转(否则登录页可能带着旧令牌)')
})

test('单飞护栏:并发 401 只处理一次,且会复位', () => {
  assert.match(api, /let handling401 = false/)
  assert.match(api, /if \(handling401\) return/)
  assert.match(api, /setTimeout\(\(\) => \{ handling401 = false \}, 1500\)/)
})

test('根布局注册 401 跳登回调并随卸载清理', () => {
  assert.match(layout, /setCnUnauthorizedHandler\(\(\) => router\.replace\('\s*\/\(auth\)\/login'\)\)/)
  assert.match(layout, /return \(\) => setCnUnauthorizedHandler\(null\)/)
})

test('退出登录(P0-01):useRouter 在组件顶层;清会话在跳页之前', () => {
  assert.match(settings, /const router = useRouter\(\)/)
  assert.doesNotMatch(settings, /await import\('expo-router'\)/, '事件处理器里动态 import expo-router 是 08-31 同类病根')
  const code = settings.replace(/\/\/.*$/gm, '')
  const iWipe = code.indexOf('wipeConversations(s.phone)')
  const iLogout = code.indexOf('cnLogout()')
  const iReplace = code.indexOf("router.replace('/(auth)/login')")
  assert.ok(iWipe > 0 && iLogout > 0 && iReplace > 0, '清会话/清令牌/跳页三步齐全')
  assert.ok(iWipe < iReplace && iLogout < iReplace, '清理必须先于跳页')
})

test('清理有兜底:清理抛错也必跳登录页', () => {
  assert.match(settings, /catch \(e\) \{\s*\/\/ 即使清理抛错也必须离开已登录界面/)
})
