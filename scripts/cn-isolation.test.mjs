// 大陆版测试 ④:会话数据按手机号隔离(承接国际版 2026-08-31 串号事故的守卫,大陆口径)
// 键随账号走、登出即弃、保密条目双保险不上云、容量截断。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const conv = read('lib/cnConversations.ts')

test('存储键按手机号命名空间(不落全局键)', () => {
  assert.match(conv, /const key = \(phone: string\) => `cn_convs:\$\{phone\}`/)
  // 全局裸键读写即串号事故形态
  assert.doesNotMatch(conv, /AsyncStorage\.(getItem|setItem)\(\s*['"]cn_convs['"]\s*\)/)
})

test('load/save 均以 phone 为第一参(无账号不落盘不读取)', () => {
  assert.match(conv, /function loadConversations\(phone: string\)/)
  assert.match(conv, /function saveConversations\(phone: string/)
})

test('登出弃本机会话:存在 wipeConversations 且按 phone 清', () => {
  assert.match(conv, /function wipeConversations\(phone: string\)/)
  assert.match(conv, /AsyncStorage\.removeItem\(key\(phone\)\)/)
})

test('保密红线:secret- 前缀条目不上云、云端拉到也不认(双保险)', () => {
  const hits = [...conv.matchAll(/startsWith\('secret-'\)/g)]
  assert.ok(hits.length >= 3, `期望 ≥3 处 secret- 跳过(拉取/上推/删除),实得 ${hits.length}`)
})

test('容量与健壮性:上限截断 + 坏数据容错', () => {
  assert.match(conv, /MAX_CONVERSATIONS = 50/)
  assert.match(conv, /if \(!raw\) return \[\]/)
  assert.match(conv, /if \(!Array\.isArray\(list\)\) return \[\]/)
})

test('云同步合并口径:updatedAt 新者胜,本地独有条目回推', () => {
  assert.match(conv, /conv\.updatedAt > local\.updatedAt/)
  assert.match(conv, /function syncPullConversations\(phone: string\)/)
})
