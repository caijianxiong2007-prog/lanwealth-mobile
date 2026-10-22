import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/cnApi.ts', import.meta.url), 'utf8')
const loginSource = readFileSync(new URL('../app/(auth)/login.tsx', import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const compiled = compile(source)
const SESSION = 'cn_session_v2', TOKEN = 'cn_session_token', PHONE = 'cn_session_phone'
const A = '13800000000', B = '13900000000'

function token(phone = A, legacy = false) {
  const payload = `${phone}.1792540800000${legacy ? '' : '.30'}`
  return `${payload}.${createHmac('sha256', 'synthetic-test-key-not-a-secret').update(payload).digest('hex').slice(0, 32)}`
}
const record = (phone = A) => JSON.stringify({ version: 2, token: token(phone), phone })
const plain = value => JSON.parse(JSON.stringify(value))

function fixture(reply, { store = new Map(), storageHook = async () => {}, platform = 'ios' } = {}) {
  const requests = [], writes = [], deletes = []
  const storage = {
    getItemAsync: async key => { await storageHook('get', key); return store.get(key) ?? null },
    setItemAsync: async (key, value) => {
      await storageHook('set', key, value)
      writes.push([key, value]); store.set(key, value)
    },
    deleteItemAsync: async key => {
      await storageHook('delete', key)
      deletes.push(key); store.delete(key)
    },
  }
  const ctx = createContext({
    exports: {}, Error, AbortController, setTimeout, clearTimeout,
    require: name => {
      if (name === 'react-native') return { Platform: { OS: platform } }
      if (name === 'expo-secure-store') return storage
      if (name === '@react-native-async-storage/async-storage') return { default: {
        getItem: storage.getItemAsync, setItem: storage.setItemAsync, removeItem: storage.deleteItemAsync,
      } }
      throw new Error('Unexpected import: ' + name)
    },
    fetch: async (url, options) => {
      const request = { url, body: JSON.parse(options.body) }
      requests.push(request)
      const result = typeof reply === 'function' ? await reply(request) : reply
      if (result instanceof Error) throw result
      assert.ok(result, 'Unexpected mock request; real network is never available')
      return { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => result.body }
    },
  })
  runInContext(compiled, ctx)
  return { api: ctx.exports, store, requests, writes, deletes }
}

for (const [kind, action] of [['po', 'scm_po_list'], ['so', 'scm_so_list']]) {
  test(`${kind}: order query resolves the authenticated enterprise and passes its context`, async () => {
    const f = fixture(request => ({ status: 200, body: request.body.action === 'fin_setup_get'
      ? { ok: true, tenant_id: 201, perms: [] } : { ok: true, items: [{id:1}] } }), { store:new Map([[SESSION,record()]]) })
    assert.deepEqual(plain(await f.api.cnOrders(kind)), [{id:1}])
    assert.deepEqual(f.requests.map(r=>plain(r.body)), [
      { action:'fin_setup_get', session_token:token() },
      { action, tenant_id:201, session_token:token() },
    ])
  })
}

test('order query stops when authenticated enterprise setup fails', async () => {
  const f = fixture({status:403,body:{error:'非企业成员'}}, {store:new Map([[SESSION,record()]])})
  await assert.rejects(f.api.cnOrders('po'), /非企业成员/)
  assert.equal(f.requests.length,1)
})

test('密码登录只原子写入一个 JSON 会话，不保存密码或写入旧双键', async () => {
  const f = fixture({ status: 200, body: { ok: true, session_token: token() } })
  assert.equal((await f.api.cnPasswordLogin(A, ' spaces are significant ')).ok, true)
  assert.deepEqual(f.requests, [{ url: 'https://app.lanwealth.cn/api', body: {
    action: 'login_password', phone: A, password: ' spaces are significant ', remember: true, source: 'app',
  } }])
  assert.deepEqual(f.writes, [[SESSION, record()]])
  assert.deepEqual(f.deletes, [TOKEN, PHONE])
  assert.deepEqual(plain(await f.api.getCnSession()), { token: token(), phone: A })
})

test('错误密码保留服务端提示，不清理已有会话或触发过期跳转', async () => {
  const f = fixture({ status: 401, body: { error: '手机号或密码不正确' } }, {
    store: new Map([[SESSION, record()]]),
  })
  let expired = 0
  f.api.setCnUnauthorizedHandler(() => { expired++ })
  const result = await f.api.cnPasswordLogin(B, 'wrong')
  assert.equal(result.ok, false)
  assert.equal(result.error, '手机号或密码不正确')
  assert.equal(expired, 0)
  assert.equal(f.writes.length, 0)
  assert.equal(f.deletes.length, 0)
  assert.equal(f.store.get(SESSION), record())
})

test('限流、服务端和网络错误不会伪造登录成功', async () => {
  for (const reply of [
    { status: 429, body: { error: '尝试次数过多，请稍后重试' } },
    { status: 503, body: { error: '服务暂不可用' } },
    new Error('Network request failed'),
  ]) {
    const f = fixture(reply)
    const result = await f.api.cnPasswordLogin(A, 'wrong')
    assert.equal(result.ok, false)
    assert.equal(result.error, reply instanceof Error ? reply.message : reply.body.error)
    assert.equal(f.writes.length, 0)
  }
})

test('缺少成功标记、坏令牌或手机号不一致时不保存登录', async () => {
  for (const body of [
    {}, { session_token: token() }, { ok: true }, { ok: true, session_token: 123 },
    { ok: true, session_token: ' ' }, { ok: true, session_token: 'not-a-token' },
    { ok: true, session_token: token(B) },
  ]) {
    const f = fixture({ status: 200, body })
    assert.equal((await f.api.cnPasswordLogin(A, 'example')).ok, false)
    assert.equal(f.writes.length, 0)
    assert.equal(f.deletes.length, 0)
  }
})

test('新单键写入失败不会产生半会话或覆盖原会话，队列随后仍可恢复', async () => {
  for (const initial of [[], [[PHONE, A]], [[SESSION, record()]]]) {
    let fail = true
    const f = fixture({ status: 200, body: { ok: true, session_token: token(B) } }, {
      store: new Map(initial),
      storageHook: async op => { if (op === 'set' && fail) throw new Error('安全存储不可用') },
    })
    const result = await f.api.cnPasswordLogin(B, 'example')
    assert.equal(result.ok, false)
    assert.equal(result.error, '安全存储不可用')
    assert.deepEqual([...f.store], initial)
    const session = await f.api.getCnSession()
    assert.equal(session?.phone ?? null, initial[0]?.[0] === SESSION ? A : null)
    fail = false
    assert.equal((await f.api.cnPasswordLogin(B, 'example')).ok, true)
    assert.equal((await f.api.getCnSession()).phone, B)
  }
})

test('旧键清理故障不影响新原子会话，且两个旧键均尝试删除', async () => {
  const attempts = []
  const f = fixture({ status: 200, body: { ok: true, session_token: token(B) } }, {
    store: new Map([[TOKEN, token()], [PHONE, A]]),
    storageHook: async (op, key) => {
      if (op === 'delete') { attempts.push(key); throw new Error('legacy delete failed') }
      if (op === 'set') assert.equal(key, SESSION)
    },
  })
  assert.equal((await f.api.cnPasswordLogin(B, 'example')).ok, true)
  assert.deepEqual(attempts, [TOKEN, PHONE])
  assert.equal((await fixture(null, { store: f.store }).api.getCnSession()).phone, B)
})

test('兼容三段和四段旧 HMAC 格式会话，但拒绝遗留混合身份和半会话', async () => {
  for (const legacy of [false, true]) {
    const f = fixture(null, { store: new Map([[TOKEN, token(A, legacy)], [PHONE, A]]) })
    assert.deepEqual(plain(await f.api.getCnSession()), { token: token(A, legacy), phone: A })
  }
  for (const entries of [
    [[TOKEN, token(B)], [PHONE, A]], [[TOKEN, token()]], [[PHONE, A]],
    [[TOKEN, 'not-a-token'], [PHONE, A]],
  ]) {
    const f = fixture(null, { store: new Map(entries) })
    assert.equal(await f.api.getCnSession(), null)
    assert.equal(f.writes.length, 0)
  }
})

test('损坏、新键混合身份和 tombstone 均不可回退到有效旧键', async () => {
  for (const value of [
    '{', 'null', '{}', JSON.stringify({ version: 2, loggedOut: true }),
    JSON.stringify({ version: 2, token: token(B), phone: A }),
  ]) {
    const f = fixture(null, { store: new Map([[SESSION, value], [TOKEN, token()], [PHONE, A]]) })
    assert.equal(await f.api.getCnSession(), null)
  }
})

test('iOS/web 新键读取故障不能被当成缺键并回退旧身份', async () => {
  for (const platform of ['ios', 'web']) {
    const f = fixture(null, {
      platform, store: new Map([[TOKEN, token()], [PHONE, A]]),
      storageHook: async (op, key) => { if (op === 'get' && key === SESSION) throw new Error('read failed') },
    })
    await assert.rejects(f.api.getCnSession(), /read failed/)
  }
})

test('遗留手机号读取失败不返回半会话，失败不阻塞后续读取', async () => {
  let fail = true
  const f = fixture(null, {
    store: new Map([[TOKEN, token()], [PHONE, A]]),
    storageHook: async (op, key) => { if (fail && op === 'get' && key === PHONE) throw new Error('legacy read failed') },
  })
  await assert.rejects(f.api.getCnSession(), /legacy read failed/)
  fail = false
  assert.equal((await f.api.getCnSession()).phone, A)
})

test('iOS/web 登出持久化 tombstone，旧双键删除失败后重启也不复活', async () => {
  for (const platform of ['ios', 'web']) {
    const f = fixture(null, {
      platform, store: new Map([[SESSION, record()], [TOKEN, token()], [PHONE, A]]),
      storageHook: async op => { if (op === 'delete') throw new Error('delete failed') },
    })
    await f.api.cnLogout()
    assert.equal(JSON.parse(f.store.get(SESSION)).loggedOut, true)
    assert.equal(await f.api.getCnSession(), null)
    assert.equal(await fixture(null, { store: f.store, platform }).api.getCnSession(), null)
    await f.api.saveCnSession(token(B), B)
    assert.equal((await f.api.getCnSession()).phone, B)
  }
})

test('tombstone 写入失败时尝试清除所有新旧键，重启不复活', async () => {
  const f = fixture(null, {
    store: new Map([[SESSION, record()], [TOKEN, token()], [PHONE, A]]),
    storageHook: async op => { if (op === 'set') throw new Error('write failed') },
  })
  await f.api.cnLogout()
  assert.deepEqual(f.deletes, [TOKEN, PHONE, SESSION])
  assert.equal(f.store.size, 0)
  assert.equal(await fixture(null, { store: f.store }).api.getCnSession(), null)
})

test('无法写 tombstone 且删除失败时显式报错，本进程仍禁止复活', async () => {
  const f = fixture(null, {
    store: new Map([[SESSION, record()], [TOKEN, token()], [PHONE, A]]),
    storageHook: async op => { if (op !== 'get') throw new Error('storage unavailable') },
  })
  await assert.rejects(f.api.cnLogout(), /storage unavailable/)
  assert.equal(await f.api.getCnSession(), null)
})

// Execute the unchanged TSX with hook/element stubs; no native renderer or network is needed.
function loginFixture(source = loginSource) {
  const slots = [], calls = [], navigations = []
  let cursor = 0
  const hook = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
  }
  const phoneContext = createContext({ exports: {} })
  runInContext(compile(readFileSync(new URL('../lib/cnPhone.ts', import.meta.url), 'utf8')), phoneContext)
  const ctx = createContext({
    exports: {}, setInterval: () => 1, clearInterval: () => {},
    require: name => {
      if (name === 'react') return {
        useState: hook, useRef: initial => hook({ current: initial })[0], useEffect: () => {},
      }
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      if (name === 'react-native') return {
        ...Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity', 'KeyboardAvoidingView', 'ActivityIndicator', 'Image', 'ScrollView'].map(name => [name, name])),
        StyleSheet: { create: value => value }, Platform: { OS: 'ios' }, Linking: { openURL: () => {} },
      }
      if (name === 'expo-router') return { useRouter: () => ({ replace: path => navigations.push(path) }) }
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }
      if (name === '../../lib/cnPhone') return phoneContext.exports
      if (name === '../../lib/cnApi') return Object.fromEntries(['cnOtpSend', 'cnOtpVerify', 'cnPasswordLogin'].map(name => [name, async (...args) => {
        calls.push({ name, args }); return { ok: name === 'cnOtpSend', error: 'mock rejection' }
      }]))
      if (name.endsWith('.png')) return 1
      throw new Error('Unexpected login import: ' + name)
    },
  })
  runInContext(compile(source), ctx)
  function nodes() {
    cursor = 0
    const all = []
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      all.push(node); visit(node.props?.children)
    }
    visit(ctx.exports.default())
    return all
  }
  const find = predicate => {
    const node = nodes().find(predicate)
    assert.ok(node, 'Expected login control is missing')
    return node.props
  }
  return {
    calls, navigations, nodes,
    input: label => find(node => node.props.accessibilityLabel === label),
    agree: () => find(node => node.props.accessibilityRole === 'checkbox').onPress(),
    passwordMode: () => find(node => node.props.accessibilityRole === 'tab' && node.props.children.props.children === '密码登录').onPress(),
    submit: () => find(node => node.props.accessibilityRole === 'button' && ['获取验证码', '验证并开始', '登录'].includes(node.props.children?.props?.children)).onPress(),
  }
}

async function prepareLogin(source, mode) {
  const f = loginFixture(source)
  if (mode === 'password') f.passwordMode()
  f.input('手机号').onChangeText(A)
  if (mode === 'password') f.input('登录密码').onChangeText('synthetic-password')
  else {
    f.agree(); await f.submit()
    f.input('短信验证码').onChangeText('123456')
    f.agree()
  }
  return f
}

async function assertConsentGate(source, mode) {
  const f = await prepareLogin(source, mode)
  await f.submit()
  assert.equal(f.calls.filter(call => call.name !== 'cnOtpSend').length, 0, `${mode} must not authenticate without consent`)
  assert.ok(f.nodes().some(node => node.props?.children === '请先阅读并勾选同意《隐私政策》与《用户协议》'))
  return f
}

for (const mode of ['sms', 'password']) {
  test(`${mode}: 未勾选实际不请求，勾选后调用对应登录 API`, async () => {
    const f = await assertConsentGate(loginSource, mode)
    f.agree(); await f.submit()
    const logins = f.calls.filter(call => call.name !== 'cnOtpSend')
    assert.equal(logins.length, 1)
    assert.equal(logins[0].name, mode === 'sms' ? 'cnOtpVerify' : 'cnPasswordLogin')
    assert.equal(f.navigations.length, 0)
  })

  test(`${mode}: 删除同意检查的内存变异必须被行为断言捕获`, async () => {
    const ast = ts.createSourceFile('login.tsx', loginSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let guard
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'verify') {
        guard = node.body.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(ast) === '!agreed')
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(guard, 'Missing consent guard is itself a regression')
    const mutant = loginSource.slice(0, guard.getStart(ast)) + loginSource.slice(guard.end)
    await assert.rejects(assertConsentGate(mutant, mode), { code: 'ERR_ASSERTION' })
  })
}

test('密码输入安全属性和滚动容器存在于实际渲染树', async () => {
  const f = await prepareLogin(loginSource, 'password')
  const input = f.input('登录密码')
  assert.equal(input.secureTextEntry, true)
  assert.equal(input.autoCorrect, false)
  assert.equal(input.autoCapitalize, 'none')
  assert.ok(f.nodes().some(node => node.type === 'ScrollView'))
})
