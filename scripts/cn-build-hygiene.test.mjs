// 大陆版测试 ⑤:构建卫生——国际链路不得回流(P1-09/P1-10 守卫)
// 扫描范围=大陆活代码面(app/ components/ lib/cn* app.json);命中国际域名/Supabase
// 运行链路即失败。版本三处一致;备案号与权限说明的中文口径。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

// 大陆活代码面:应用代码 + cn 数据层 + 应用配置(components 目录可能不存在,容错)
const activeFiles = [
  ...walk(join(root, 'app'), ['.tsx', '.ts']),
  ...walk(join(root, 'lib'), ['.ts']).filter((p) => /\/cn[A-Z]/.test(p) || p.endsWith('cnPhone.ts') || p.endsWith('cnConversations.ts') || p.endsWith('cnApi.ts')),
  join(root, 'app.json'),
]
if (existsSync(join(root, 'components')))
  activeFiles.push(...walk(join(root, 'components'), ['.tsx', '.ts']))

const FORBIDDEN = [
  { re: /app\.lanwealth\.com/, label: '国际版主域 app.lanwealth.com' },
  { re: /app\.bayze\.cn/, label: '已下线的 app.bayze.cn' },
  { re: /supabase\.(co|io)/, label: 'Supabase 运行链路' },
]

test('活代码面零国际域名/Supabase 引用', () => {
  const offenders = []
  for (const f of activeFiles) {
    const text = readFileSync(f, 'utf8')
    for (const { re, label } of FORBIDDEN)
      if (re.test(text)) offenders.push(`${f.replace(root + '/', '')} → ${label}`)
  }
  assert.deepEqual(offenders, [], `国际链路回流:\n  ${offenders.join('\n  ')}`)
})

test('国际版死页不复活:tools.tsx 与 PhoneAuth.tsx 不得回归', () => {
  assert.ok(!existsSync(join(root, 'app/(tabs)/tools.tsx')), 'tools.tsx 又回来了(深链可直达国际导流页)')
  assert.ok(!existsSync(join(root, 'components/PhoneAuth.tsx')), 'PhoneAuth.tsx 又回来了(International Supabase 登录组件)')
  const tabs = readFileSync(join(root, 'app/(tabs)/_layout.tsx'), 'utf8')
  assert.doesNotMatch(tabs, /name="tools"/, 'tab 配置里仍注册着 tools')
})

test('版本单一真值:package.json = app.json = 设置页兜底', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
  const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8')
  const v = app.expo.version
  assert.ok(/^\d+\.\d+\.\d+$/.test(v), `app.json 版本格式非常规:${v}`)
  assert.equal(pkg.version, v, 'package.json 与 app.json 版本不一致')
  assert.ok(settings.includes(`Constants.expoConfig?.version || '${v}'`), '设置页版本兜底值与 app.json 不一致')
})

test('APP 备案号已填且格式正确', () => {
  const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8')
  const m = settings.match(/const APP_ICP = '([^']+)'/)
  assert.ok(m && /^沪ICP备\d+号-\d+[A-Z]?$/.test(m[1]), `备案号缺失或格式异常:${m && m[1]}`)
  assert.match(settings, /APP 备案:\$\{APP_ICP\}/, '备案号未在界面渲染')
})

test('iOS 权限说明已中文化(无英文占位)', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
  const descs = Object.values(app.expo.ios?.infoPlist || {}).filter((v) => typeof v === 'string')
  assert.ok(descs.length >= 2, '未找到 iOS 权限说明')
  for (const d of descs) assert.ok(!/^(Allow|Use) /.test(d), `仍有英文权限说明:${d}`)
})
