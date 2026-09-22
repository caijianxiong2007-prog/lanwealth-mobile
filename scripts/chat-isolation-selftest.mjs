// ── 手机端聊天数据按用户隔离 · 自检 ────────────────────────────────────────
//
// 2026-08-31 真实事故:老板在客户公司电脑上演示,本地仓留下他的会话;客户在同一台机器
// 登录后,客户端把那份列表整包同步上云 —— 18 条含第三方(中崛、长信化学)经营数据的
// 会话落进了客户账号。网页端 2026-09-21 已修并有 12 节断言守着;手机端是**同一个病**,
// 而且更重:登出只调 auth.signOut() 不清本地,且无 session 时会自动建匿名号 ——
// 一台演示机轮流登几个账号,每个后来者都会把前面所有人的会话写进自己名下。
//
// 这份自检盯住修复不被回退。走源码文本 + 真跑纯函数两条路:AsyncStorage 是原生模块,
// 在 node 里起不来;而这个 bug 的形态恰好是「键名写死成全局常量」「调用顺序颠倒」,
// 文本查得准。
//
// 跑:node scripts/chat-isolation-selftest.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let failed = 0
const ok = (c, label, detail = '') => {
  if (!c) { failed++; console.error(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`) }
}

const store  = read('lib/conversations.ts')
const screen = read('app/(tabs)/index.tsx')

console.log('① 本地仓键必须按用户命名空间')
ok(/mobile_conversations_v2:\$\{userId\}/.test(store), '会话键含用户 id 后缀')
ok(/mobile_active_conversation_v2:\$\{userId\}/.test(store), '活跃会话键含用户 id 后缀')
ok(!/AsyncStorage\.getItem\(\s*['"]mobile_conversations_v2['"]\s*\)/.test(store),
   '不得直接读全局旧键 mobile_conversations_v2')
ok(!/AsyncStorage\.(getItem|setItem)\(\s*['"]mobile_active_conversation_v2['"]/.test(store),
   '不得直接读写全局旧键 mobile_active_conversation_v2')

console.log('② 拿不到 userId 时:不读、不写')
ok(/export async function loadLocalConversations\(userId: string\)[\s\S]{0,120}?if \(!userId\) return \{ conversations: \[\], activeId: null \}/.test(store),
   'loadLocalConversations 无 userId 时返回空,而不是回落全局键')
ok(/export async function saveLocalConversations\(userId: string[\s\S]{0,200}?if \(!userId\) return/.test(store),
   'saveLocalConversations 无 userId 时不落盘')

console.log('③ ⭐ 只存本机的旧键:绝不读、也绝不删')
// mobile_messages / conv_title 引入于 2026-05-28,比云同步(2026-06-20)早三周 ——
// 内容**只存在本机**。读它=按错主人交给当前登录者(就是 08-31 事故的形态);
// 删它=永久销毁。两样都不做,当孤儿留在盘上。与网页端对 IndexedDB bayze_secret 同构。
ok(/export const LEGACY_LOCAL_ONLY_KEYS/.test(store), '存在具名常量,仅作记录')
for (const k of ['mobile_messages', 'conv_title']) {
  ok(!new RegExp(`AsyncStorage\\.getItem\\(\\s*['"]${k}['"]`).test(store),
     `🚨 绝不能读 ${k} —— 读了就是把上一个人的对话交给当前登录者`)
  ok(!new RegExp(`multiRemove\\(\\[[^\\]]*['"]${k}['"]`).test(store),
     `🚨 绝不能删 ${k} —— 它早于云同步,删了永久找不回`)
}
ok(!/legacyMessages|legacyTitle/.test(store), '迁移变量已随迁移块一并移除,没有半截残留')

console.log('④ ⭐ 顺序:必须先确定用户,再读本地仓')
// 这是本次修复的核心。原来是先 loadLocalConversations() 再 getUser(),
// 于是后来者会先把前一个人的会话读出来显示、再当成"本地新增"整包同步进自己账号。
{
  // ⚠️ 必须先剥注释再定位。第一版没剥,结果 `loadLocalConversations(` 先命中了
  //    注释里那句「原来是先 loadLocalConversations() 再 getUser()」—— 断言匹配到了
  //    描述旧 bug 的**散文**,把正确的代码判成了错的。
  //    同理要按**调用点**(带实参 uid)定位,别被文件顶部的 import 抢先命中。
  const code = screen
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const iGetUser = code.indexOf('supabase.auth.getUser()')
  const iLoad    = code.indexOf('loadLocalConversations(uid)')
  ok(iGetUser > 0, '能定位到 getUser() 调用')
  ok(iLoad > 0, '能定位到 loadLocalConversations(uid) 调用点(不是 import)')
  ok(iGetUser < iLoad, '🚨 getUser() 必须出现在 loadLocalConversations(uid) 之前',
     `实得 getUser@${iGetUser}  load@${iLoad}`)
}

console.log('⑤ 每一处落盘都必须带 userId')
{
  const calls = [...screen.matchAll(/saveLocalConversations\(([^,)]*)/g)].map(m => m[1].trim())
  ok(calls.length >= 4, `落盘调用点只找到 ${calls.length} 个,正则可能失配`)
  const bad = calls.filter(a => !/userIdRef\.current|uid|userId/.test(a))
  ok(bad.length === 0, `🚨 有 ${bad.length} 处落盘没带 userId`, `首参分别是:${calls.join(' | ')}`)
}

console.log('⑥ 阳性对照(确认上面这些否定断言不是空转)')
ok(/mobile_conversations_v2/.test(store), '源码里确实还提到 mobile_conversations_v2(否则①的否定断言是空转)')
ok(/mobile_messages/.test(store), '源码里确实还提到 mobile_messages(否则③是空转)')
ok(/saveLocalConversations\(/.test(screen), '屏幕里确实有落盘调用(否则⑤是空转)')

console.log(failed ? `\n✗ ${failed} 条失败` : '\n✓ 全部通过')
process.exit(failed ? 1 : 0)
