// 大陆版测试 ⑦:工作台(P2-01 一期)与套餐四态(P2-02)锚点
// 工作台全部复用网页版既有动作——锚点同时守住「动作名不漂移」与「tab 不消失」;
// 四态守「加载失败不再冒充体验版」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('工作台页存在且已注册为 Tab', () => {
  const wb = read('app/(tabs)/workbench.tsx')
  const tabs = read('app/(tabs)/_layout.tsx')
  assert.ok(wb.length > 5000, 'workbench.tsx 过小,页面可能被清空')
  assert.match(tabs, /name="workbench"/, 'tab 注册丢失')
  assert.match(tabs, /title: '工作台'/)
})

test('工作台动作层复用网页版既有动作(名字不漂移)', () => {
  const api = read('lib/cnApi.ts')
  for (const act of ['fin_setup_get', 'biz_todo_list', 'biz_todo_done', 'fin_expense_decide',
    'fin_expense_create', 'fin_expense_submit', 'fin_expense_list', 'scm_po_list', 'scm_so_list', 'knowledge_search']) {
    assert.ok(api.includes(`action: '${act}'`) || api.includes(`'${act}'`), `动作 ${act} 不在 cnApi 工作台层`)
  }
  // 费用提交后必须自动送审(create+submit 两连)
  assert.match(api, /fin_expense_submit/, '缺自动送审')
})

test('工作台无企业上下文的引导与错误重试', () => {
  const wb = read('app/(tabs)/workbench.tsx')
  assert.match(wb, /未开通企业/, '无企业态引导缺失')
  assert.match(wb, /加载失败:/, '错误态呈现缺失')
})

test('套餐四态:加载失败不再冒充体验版,且有重试(P2-02)', () => {
  const st = read('app/(tabs)/settings.tsx')
  const api = read('lib/cnApi.ts')
  assert.match(api, /cnPlanInfoEx/, '四态查询函数缺失')
  assert.match(st, /套餐信息加载失败/, '失败态文案缺失')
  assert.match(st, /体验版\(未订阅\)/, '未订阅态与失败态必须可区分')
  assert.match(st, /重试加载/, '重试入口缺失')
  assert.match(st, /setPlanErr/, '失败状态位缺失')
})

test('审批走二次确认(误触防线)', () => {
  const wb = read('app/(tabs)/workbench.tsx')
  assert.match(wb, /verb \+ '费用申请'/, '审批确认弹窗缺失')
  assert.match(wb, /\\n\\n确认' \+ verb/, '确认文案未含单据与金额')
})
