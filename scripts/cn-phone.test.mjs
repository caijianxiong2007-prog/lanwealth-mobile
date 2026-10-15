// 大陆版测试 ①:手机号工具纯函数(真跑,非文本断言;node 24 原生跑 TS)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, isCnMobile, maskPhone } from '../lib/cnPhone.ts'

test('normalizePhone:剔除非数字', () => {
  assert.equal(normalizePhone('138 0013 8000'), '13800138000')
  assert.equal(normalizePhone('+86 138-0013-8000'), '8613800138000')
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone(null), '')
  assert.equal(normalizePhone(undefined), '')
})

test('isCnMobile:大陆 11 位号段校验', () => {
  for (const good of ['13800138000', '15912345678', '19900000000', '16612345678'])
    assert.equal(isCnMobile(good), true, good)
  for (const bad of ['12345678901', '23800138000', '1380013800', '138001380001', '', 'abc'])
    assert.equal(isCnMobile(bad), false, bad)
  // 带杂质输入先归一再校验
  assert.equal(isCnMobile('138 0013 8000'), true)
})

test('maskPhone:11 位打码中间四位;非 11 位原样返回归一值', () => {
  assert.equal(maskPhone('13800138000'), '138****8000')
  assert.equal(maskPhone('138 0013 8000'), '138****8000')
  assert.equal(maskPhone('12345'), '12345')
  assert.equal(maskPhone(''), '')
})
