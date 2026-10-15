// 大陆版手机号工具(纯函数,无 RN 依赖——Node 测试可直跑)
// 2026-10-15 抽出:登录/校验逻辑单一真值,scripts/cn-phone.test.mjs 守着。
export function normalizePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '')
}

export function isCnMobile(p: string): boolean {
  return /^1[3-9]\d{9}$/.test(normalizePhone(p))
}

export function maskPhone(p: string): string {
  const n = normalizePhone(p)
  return n.length === 11 ? n.slice(0, 3) + '****' + n.slice(7) : n
}
