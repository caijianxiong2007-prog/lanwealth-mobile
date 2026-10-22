// 大陆版测试 ③:统一 401 登出 + 退出登录顺序(P1-08/P0-01 回归守卫)
// 要求:401 → 清会话 → 单次跳登录;多在途请求并发 401 只处理一次;
// 退出登录:先清本机会话数据再跳页;useRouter 必须组件顶层调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const api = read('lib/cnApi.ts')
const layout = read('app/_layout.tsx')
const settings = read('app/(tabs)/settings.tsx')

const SESSION = 'cn_session_v2'
const A = '13800000000', B = '13900000000'
const compiled = ts.transpileModule(api, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function token(phone = A, sequence = 0) {
  const payload = `${phone}.${1792540800000 + sequence}.30`
  return `${payload}.${createHmac('sha256', 'synthetic-test-key-not-a-secret').update(payload).digest('hex').slice(0, 32)}`
}
const record = (phone = A, sequence = 0) => JSON.stringify({ version: 2, token: token(phone, sequence), phone })
function gate() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const unauthorized = () => ({ status: 401, body: { error: 'mock expired' } })

function fixture({ respond = unauthorized, storageHook = async () => {} } = {}) {
  const store = new Map([[SESSION, record()]])
  const events = []
  const ctx = createContext({
    exports: {}, Error, AbortController, setTimeout, clearTimeout,
    require: name => {
      if (name === 'react-native') return { Platform: { OS: 'ios' } }
      if (name === 'expo-secure-store') return {
        getItemAsync: async key => { await storageHook('get', key); return store.get(key) ?? null },
        setItemAsync: async (key, value) => { await storageHook('set', key, value); events.push(['set', key, value]); store.set(key, value) },
        deleteItemAsync: async key => { await storageHook('delete', key); events.push(['delete', key]); store.delete(key) },
      }
      if (name === '@react-native-async-storage/async-storage') return {}
      throw new Error('Unexpected import: ' + name)
    },
    fetch: async (_url, options) => {
      const response = await respond(JSON.parse(options.body))
      return { status: response.status, ok: response.status >= 200 && response.status < 300, json: async () => response.body }
    },
  })
  runInContext(compiled, ctx)
  let redirects = 0
  ctx.exports.setCnUnauthorizedHandler(() => {
    assert.equal(JSON.parse(store.get(SESSION)).loggedOut, true, 'Persist logout before navigation')
    events.push(['redirect']); redirects++
  })
  return { api: ctx.exports, store, events, redirects: () => redirects }
}

const requests = {
  post: api => api.cnUsage().catch(error => error),
  ocr: api => api.cnOcr('synthetic-image'),
}

for (const [kind, request] of Object.entries(requests)) {
  test(`${kind}: 当前令牌 401 先持久化注销，再单次跳登录`, async () => {
    const f = fixture()
    await request(f.api)
    assert.equal(await f.api.getCnSession(), null)
    assert.equal(f.redirects(), 1)
    assert.equal(f.events[0][0], 'set')
    assert.equal(f.events.at(-1)[0], 'redirect')
  })

  for (const phone of [A, B]) {
    test(`${kind}: 旧 401 跨越退出和${phone === A ? '同账号刷新' : '换账号'}登录，不删除新会话`, async () => {
      const started = gate(), reply = gate()
      const f = fixture({ respond: async body => {
        if (body.action === 'login_password') return { status: 200, body: { ok: true, session_token: token(phone, 1) } }
        assert.equal(body.session_token, token())
        started.resolve(); return reply.promise
      } })
      const old = request(f.api)
      await started.promise
      await f.api.cnLogout()
      assert.equal((await f.api.cnPasswordLogin(phone, 'synthetic-password')).ok, true)
      const before = f.events.length
      reply.resolve(unauthorized()); await old
      assert.equal(f.store.get(SESSION), record(phone, 1))
      assert.equal((await f.api.getCnSession()).token, token(phone, 1))
      assert.equal(f.events.length, before)
      assert.equal(f.redirects(), 0)
    })
  }
}

test('多个 post/OCR 并发 401 只清理和跳转一次，新令牌随后仍可独立过期', async () => {
  const f = fixture()
  await Promise.all([requests.post(f.api), requests.post(f.api), requests.ocr(f.api)])
  assert.equal(f.redirects(), 1)
  assert.equal(f.events.filter(event => event[0] === 'set').length, 1)
  await f.api.saveCnSession(token(B), B)
  await requests.post(f.api)
  assert.equal(f.redirects(), 2)
  assert.equal(await f.api.getCnSession(), null)
})

test('无请求令牌的 OTP 401 不清除已有会话', async () => {
  const f = fixture()
  assert.equal((await f.api.cnOtpSend(A)).ok, false)
  assert.equal((await f.api.cnOtpVerify(A, '123456', true)).ok, false)
  assert.equal(f.store.get(SESSION), record())
  assert.equal(f.redirects(), 0)
  assert.equal(f.events.length, 0)
})

test('比较旧令牌后暂停清理时，新登录写入必须等清理和跳转完成', async () => {
  const clearing = gate(), release = gate(), loginReply = gate()
  let held = false, newWriteStarted = false
  const f = fixture({
    respond: body => {
      if (body.action === 'login_password') {
        loginReply.resolve()
        return { status: 200, body: { ok: true, session_token: token(B) } }
      }
      return unauthorized()
    },
    storageHook: async (op, key, value) => {
      if (op !== 'set' || key !== SESSION) return
      if (JSON.parse(value).loggedOut && !held) {
        held = true; clearing.resolve(); await release.promise
      } else if (JSON.parse(value).token === token(B)) newWriteStarted = true
    },
  })
  const expired = requests.post(f.api)
  await clearing.promise
  const login = f.api.cnPasswordLogin(B, 'synthetic-password')
  await loginReply.promise
  await new Promise(setImmediate)
  assert.equal(newWriteStarted, false, 'Login must not interleave between comparison and cleanup')
  release.resolve()
  await expired
  assert.equal((await login).ok, true)
  assert.equal(f.store.get(SESSION), record(B))
  const redirect = f.events.findIndex(event => event[0] === 'redirect')
  const newWrite = f.events.findIndex(event => event[0] === 'set' && event[2] === record(B))
  assert.ok(redirect >= 0 && newWrite > redirect)
})

test('新登录写入暂停时到达旧 401，必须等写入后重新比较而不能删新会话', async () => {
  const started = gate(), oldReply = gate(), writing = gate(), release = gate()
  const f = fixture({
    respond: async body => {
      if (body.action === 'login_password') return { status: 200, body: { ok: true, session_token: token(B) } }
      started.resolve(); return oldReply.promise
    },
    storageHook: async (op, key, value) => {
      if (op === 'set' && key === SESSION && JSON.parse(value).token === token(B)) {
        writing.resolve(); await release.promise
      }
    },
  })
  const old = requests.post(f.api)
  await started.promise
  const login = f.api.cnPasswordLogin(B, 'synthetic-password')
  await writing.promise
  oldReply.resolve(unauthorized())
  await new Promise(setImmediate)
  assert.equal(f.events.length, 0)
  release.resolve()
  assert.equal((await login).ok, true)
  await old
  assert.equal(f.store.get(SESSION), record(B))
  assert.equal(f.redirects(), 0)
})

test('公开登出和读取也与会话写入串行化，最后登出不能被在途写入覆盖', async () => {
  const writing = gate(), release = gate()
  const f = fixture({ storageHook: async (op, key, value) => {
    if (op === 'set' && key === SESSION && JSON.parse(value).token === token(B)) {
      writing.resolve(); await release.promise
    }
  } })
  const saving = f.api.saveCnSession(token(B), B)
  await writing.promise
  const logout = f.api.cnLogout()
  const reading = f.api.getCnSession()
  release.resolve()
  await saving; await logout
  assert.equal(await reading, null)
  assert.equal(JSON.parse(f.store.get(SESSION)).loggedOut, true)
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
