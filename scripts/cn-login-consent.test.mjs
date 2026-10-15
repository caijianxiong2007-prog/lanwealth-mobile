// 大陆版测试 ②:登录页协议同意(P0-02 回归守卫)
// 个人信息合规:未勾选不得发码;默认不勾;同意版本随发码上送;协议链接可达域。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const login = read('app/(auth)/login.tsx')
const api = read('lib/cnApi.ts')

test('同意框默认未勾选(useState(false))', () => {
  assert.match(login, /setAgreed\]\s*=\s*useState\(false\)/)
})

test('发码前有同意门,且在手机号校验之前', () => {
  const code = login.replace(/\/\/.*$/gm, '')   // 剥行注释防散文误命中
  const iAgree = code.indexOf('if (!agreed)')
  const iPhone = code.indexOf('isCnMobile(p)')
  assert.ok(iAgree > 0, '找不到 if (!agreed) 同意门')
  assert.ok(iPhone > 0, '找不到 isCnMobile(p) 手机号校验')
  assert.ok(iAgree < iPhone, '同意门必须在手机号校验之前')
})

test('同意版本常量存在且随发码上送', () => {
  assert.match(login, /const PRIVACY_VERSION = '20\d{2}-\d{2}-v\d+'/)
  assert.match(login, /cnOtpSend\(p,\s*\{\s*version: PRIVACY_VERSION,\s*channel: 'app'\s*\}\)/)
})

test('cnOtpSend 签名接受 consent 且不上送时不影响请求', () => {
  assert.match(api, /cnOtpSend\(phone: string,\s*consent\?:\s*\{\s*version: string[^}]*\}\)/)
  assert.match(api, /\.\.\.\(consent \? \{ consent \} : \{\}\)/)
})

test('协议链接指向大陆域隐私政策与服务条款页', () => {
  assert.match(login, /openURL\('https:\/\/app\.lanwealth\.cn\/privacy'\)/)
  assert.match(login, /openURL\('https:\/\/app\.lanwealth\.cn\/terms'\)/)
})

test('勾选控件具备无障碍语义(accessibilityRole=checkbox)', () => {
  assert.match(login, /accessibilityRole="checkbox"/)
  assert.match(login, /accessibilityState=\{\{ checked: agreed \}\}/)
})
