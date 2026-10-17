import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CN_DEMO_SCENARIOS, getDemoScenario } from '../lib/cnDemo.ts'

test('演示场景有独立示例资料和结果，未知场景不生成答案', () => {
  assert.equal(new Set(CN_DEMO_SCENARIOS.map(s => s.id)).size, 3)
  for (const scenario of CN_DEMO_SCENARIOS) {
    assert.ok(scenario.source && scenario.request && scenario.result)
    assert.equal(getDemoScenario(scenario.id), scenario)
  }
  assert.equal(getDemoScenario('unrecognized'), null)
})

test('演示为公开登录页入口，不生成会话凭据、不访问后端或持久化资料', () => {
  const page = readFileSync(new URL('../app/(auth)/demo.tsx', import.meta.url), 'utf8')
  const data = readFileSync(new URL('../lib/cnDemo.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(page + data, /\bfetch\s*\(|cnApi|cnConversations|SecureStore|AsyncStorage|session_token|cnOtp/)
  assert.match(page, /预置示例.*不调用真实模型/)
  const login = readFileSync(new URL('../app/(auth)/login.tsx', import.meta.url), 'utf8')
  assert.match(login, /router\.push\('\/\(auth\)\/demo'\)/)
  assert.match(login, /无需登录，体验演示/)
})
