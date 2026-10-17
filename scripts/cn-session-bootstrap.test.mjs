import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readStartupSession } from '../lib/cnSessionBootstrap.ts'

test('startup preserves a valid session and handles missing credentials', async () => {
  const session = { token: 'test', phone: 'test' }
  assert.equal(await readStartupSession(async () => session), session)
  assert.equal(await readStartupSession(async () => null), null)
})
test('credential errors and hangs resolve to signed-out, not a synthetic account', async () => {
  assert.equal(await readStartupSession(async () => { throw new Error('unavailable') }), null)
  assert.equal(await readStartupSession(() => new Promise(() => {}), 10), null)
})
test('root navigation mounts before redirecting, with no null startup screen', () => {
  const root = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(root, /if \(!ready\) return null/)
  assert.match(root, /if \(!ready\) return\s+if \(session/)
  assert.match(root, /<Stack screenOptions=/)
})
