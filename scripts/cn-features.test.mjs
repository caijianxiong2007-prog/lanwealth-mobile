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
const layout = read('app/(tabs)/_layout.tsx')
const settings = read('app/(tabs)/settings.tsx')
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

test('语音权限中文预告+一键去设置恢复路径(P2-03)', () => {
  assert.match(chat, /getPermissionsAsync/, '授权前先查状态')
  assert.match(chat, /仅在你按住语音按钮说话时采集/, '中文用途预告(何时采集说清楚)')
  assert.match(chat, /Linking\.openSettings\(\)/, '拒绝后提供一键去设置')
})

test('权限预告无延迟路径(5.1.1(iv)):说明后总是直接进入系统授权', () => {
  const start = chat.indexOf('启用语音输入')
  const end = chat.indexOf('requestPermissionsAsync()', start)
  assert.ok(start >= 0 && end > start, '语音预告与系统授权流程存在')
  const seg = chat.slice(start, end)
  assert.ok(!seg.includes('暂不'), '预告弹窗不得提供「暂不」延迟按钮(5.1.1(iv))')
  assert.match(seg, /继续/, '预告弹窗唯一按钮=继续,点后必入系统授权')
})

test('对话接口走 /api(cn-chat)而业务数据走 /crm-api(cn-api)', () => {
  assert.match(api, /await post\('\/api', \{ action: 'otp_send'/)
  assert.match(api, /await post\('\/crm-api', \{ action: 'account_delete_request'/)
})

// ═══ 第三轮审核整改(2026-11-02):AI 数据授权 + 企业专属门 ═══

test('AI 数据处理授权门(5.1.1(i)/5.1.2(i)):首次发送前明示并征得同意,可拒绝', () => {
  const start = chat.indexOf('async function send()')
  const end = chat.indexOf('setBusy(true)', start)
  assert.ok(start >= 0 && end > start, 'send 函数存在')
  const seg = chat.slice(start, end)
  assert.match(seg, /getAiConsent\(\)/, '发送前检查同意状态')
  assert.match(seg, /阿里云通义千问/, '明示数据接收方(发给谁)')
  assert.match(seg, /文档与图片内容/, '明示发送内容(发什么)')
  assert.match(seg, /用于生成回复/, '明示用途')
  assert.match(seg, /'不同意'/, '允许拒绝(数据共享同意必须有拒绝路径)')
  assert.match(seg, /'同意并继续'/, '同意后继续发送')
  assert.match(seg, /setAiConsent\(new Date/, '同意落库')
})

test('「我的」页可查看与撤回 AI 数据授权(5.1.2)', () => {
  assert.match(settings, /AI 数据处理授权/, '设置页有授权入口行')
  assert.match(settings, /撤回授权/, '已同意状态可撤回')
  assert.match(settings, /setAiConsent\(null\)/, '撤回即清除同意记录')
})

test('iOS 企业专属门(3.1.1/3.1.3(c)):无企业身份进引导页,Android 不受影响', () => {
  assert.match(layout, /Platform\.OS === 'ios' \? 'checking' : 'pass'/, '门仅对 iOS 生效')
  assert.match(layout, /if \(Platform\.OS !== 'ios'\) return/, 'Android 直接放行')
  assert.match(layout, /cnWorkSetup\(\)/, '企业身份走服务端 fin_setup_get 鉴权')
  assert.match(layout, /non-enterprise/, '无企业身份分支存在')
  assert.match(layout, /面向企业用户/, '引导页说明定位')
  assert.match(layout, /app\.lanwealth\.cn/, '引导个人用户去网页版')
  assert.match(layout, /wipeConversations/, '切换账号清理本机会话')
})

test('iOS 元数据口径(2.3.10/3.1.1):App 内不出现安卓版引用与个人用户引流', () => {
  assert.ok(!layout.includes('安卓'), '引导屏不得出现安卓版引用(2.3.10)')
  assert.ok(!layout.includes('个人用户'), '引导屏不得做个人用户引流(3.1.1 消费者通道)')
  assert.match(layout, /请联系贵司管理员/, '无企业身份的指引=联系企业管理员')
})
