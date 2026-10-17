export interface DemoScenario {
  id: string
  title: string
  sourceTitle: string
  source: string
  request: string
  result: string
}

// Bundled examples only: no account, network, model calls or persistent storage.
export const CN_DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'meeting', title: '会议整理', sourceTitle: '示例会议记录.txt',
    source: '10月12日项目例会：包装方案由产品组周三前确认；采购组收到最终规格后两天内询价；销售组周五向客户反馈排期。客户尚未确认首批数量。',
    request: '请整理会议要点、待办及需要确认的问题。',
    result: '会议要点\n本周先确认包装规格，再进行采购询价，并向客户反馈排期。\n\n待办清单\n1. 产品组：周三前确认包装方案。\n2. 采购组：收到最终规格后两天内完成询价。\n3. 销售组：周五向客户反馈排期。\n\n待确认\n客户首批数量尚未确定，需要销售组进一步确认。',
  },
  {
    id: 'document', title: '资料摘要', sourceTitle: '示例产品资料.txt',
    source: '样品收纳盒：尺寸240×160×80毫米，材质PP，颜色蓝色和白色。单箱装12件。标准交期为确认样品后7个工作日。支持贴标，设计文件由客户提供。',
    request: '请提取产品规格、交付条件及还需要确认的信息。',
    result: '产品规格\n尺寸：240×160×80毫米\n材质：PP\n颜色：蓝色、白色\n包装：12件/箱\n\n交付条件\n确认样品后7个工作日交付；可贴标，设计文件由客户提供。\n\n待确认\n资料未说明价格、起订量、运费及付款条件，报价前需要补齐。',
  },
  {
    id: 'email', title: '询价邮件', sourceTitle: '示例采购需求.txt',
    source: '采购需求：PP样品收纳盒120件，蓝色和白色各60件，尺寸240×160×80毫米。希望供应商提供单价、运费、交期及付款条件。',
    request: '请依据采购需求起草一封询价邮件，不虚构价格。',
    result: '主题：PP样品收纳盒采购询价\n\n您好：\n\n我司计划采购PP样品收纳盒120件，具体要求如下：\n尺寸：240×160×80毫米；\n颜色及数量：蓝色60件、白色60件。\n\n烦请提供产品单价、运费、预计交期及付款条件。如有起订量或包装要求，也请一并说明。\n\n期待您的回复，谢谢。',
  },
]

export function getDemoScenario(id: string): DemoScenario | null {
  return CN_DEMO_SCENARIOS.find(item => item.id === id) ?? null
}
