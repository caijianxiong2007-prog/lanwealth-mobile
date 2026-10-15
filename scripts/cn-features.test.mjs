// 大陆版测试 ⑥:关键功能锚点(流式停止/附件/分享/额度/注销工单/记住登录)
// RN 组件无法在 node 起来,这里守住「功能接线不悄悄断」——源码锚点消失即失败。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const chat = read('app/(tabs)/index.tsx')
const api = read('lib/cnApi.ts')

test('流式对话有停止通道(cnStopStream + abort 兜底清理)', () => {
  assert.match(chat, /cnStopStream/)
  assert.match(chat, /abortRef/)
  assert.match(chat, /const cnActiveCleanup = \(\) => \{ abortRef\.current = null \}/)
})

test('拍照/相册附件走相机权限申请 + base64 上行', () => {
  assert.match(chat, /ImagePicker\.requestCameraPermissionsAsync\(\)/)
  assert.match(chat, /launchCameraAsync\(\{[^}]*base64: true/)
  assert.match(api, /action: 'ocr', session_token: session\.token, image/)
})

test('系统分享入口被消费(分享内容进对话,处理完 reset)', () => {
  assert.match(chat, /useShareIntentContext\(\)/)
  assert.match(chat, /resetShareIntent\(\)/)
})

test('额度错误有专门标记(quota),前端可区分提示', () => {
  assert.match(api, /if \(j\.quota\) err\.quota = true/)
  assert.match(chat, /quota/, '聊天屏未读取 quota 标记')
})

test('注销工单走服务端 account_delete_request(带令牌)', () => {
  assert.match(api, /action: 'account_delete_request', session_token: session\.token/)
})

test('OTP 验证带 remember 参数(30 天免登口径)', () => {
  assert.match(api, /cnOtpVerify\(phone: string, code: string, remember: boolean\)/)
  assert.match(api, /action: 'otp_verify', phone, code, remember/)
})

test('令牌仅存 SecureStore(原生端不走 AsyncStorage 明文)', () => {
  const native = api.replace(/\/\/.*$/gm, '')
  assert.match(native, /if \(Platform\.OS !== 'web'\) return SecureStore\.getItemAsync\(key\)/)
  assert.match(native, /if \(Platform\.OS !== 'web'\) return SecureStore\.setItemAsync\(key, value\)/)
})

test('对话接口走 /api(cn-chat)而业务数据走 /crm-api(cn-api)', () => {
  assert.match(api, /await post\('\/api', \{ action: 'otp_send'/)
  assert.match(api, /await post\('\/crm-api', \{ action: 'account_delete_request'/)
})
