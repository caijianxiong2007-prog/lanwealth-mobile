// 大陆版设置页(cn 分支,v3):账号 + 套餐/额度卡片(进度条+到期提醒) + 近 7 天用量 + 注销 + 登出。
// 续费/发票跳网页版 /billing(微信扫码支付,付款后自动开通)—— 仅 Android;
// iOS 提审口径(Guideline 3.1.1/3.1.3 多平台模式):不展示任何购买/续费入口与外链,
// 用户在网页付款后回 App 登录即用(已购服务访问)。App 内提供注销入口(5.1.1(v))与隐私政策链接。
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Linking, Platform, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getCnSession, cnLogout, cnUsage, cnPlanInfo, cnAccountDelete, CN_BASE, type CnUsage, type CnPlan } from '../../lib/cnApi'
import { wipeConversations } from '../../lib/cnConversations'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', tealDim: 'rgba(26,235,168,.1)', red: '#e05656', amber: '#e8b432',
}

const isIOS = Platform.OS === 'ios'

// APP 备案号(工作清单 2.1):工信部下发后把 APP_ICP 填上号码 → 重新构建即展示
const APP_ICP = ''
const APP_VERSION = '0.2.13'

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const [phone, setPhone]         = useState('')
  const [usage, setUsage]         = useState<CnUsage | null>(null)
  const [plan, setPlan]           = useState<CnPlan | null>(null)
  const [loading, setLoading]     = useState(true)
  const [delBusy, setDelBusy]     = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const s = await getCnSession()
      if (alive) setPhone(s?.phone || '')
      try { const u = await cnUsage(); if (alive) setUsage(u) } catch {}
      try { const p = await cnPlanInfo(); if (alive) setPlan(p) } catch {}
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // 近 7 天:调用次数与 tokens 汇总
  const week = (usage || []).filter((r) => r.day >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const calls7 = week.reduce((s, r) => s + r.calls, 0)
  const tokens7 = week.reduce((s, r) => s + Number(r.prompt_tokens || 0) + Number(r.completion_tokens || 0), 0)

  // 套餐进度与到期
  const pct = plan && plan.limit > 0 ? Math.min(100, Math.round(plan.used / plan.limit * 100)) : 0
  const daysLeft = plan?.expires ? Math.ceil((new Date(plan.expires).getTime() - Date.now()) / 86400000) : null
  const expiring = daysLeft !== null && daysLeft <= 7

  async function logout() {
    const s = await getCnSession()
    if (s) await wipeConversations(s.phone)   // 会话仅存本机:登出即清,不留给下一账号
    await cnLogout()
    const { useRouter } = await import('expo-router')
    useRouter().replace('/(auth)/login')
  }

  // 账号注销(App 内发起,5.1.1(v)):两段确认 → 提交申请(顾问电话核实后执行)
  function delAccount() {
    Alert.alert('申请注销账号', '注销后将删除该手机号名下的账号、知识库、文件、客户记忆与用量记录(法律要求留存的日志除外),不可恢复。\n\n继续吗?', [
      { text: '取消', style: 'cancel' },
      {
        text: '继续', style: 'destructive', onPress: () => {
          Alert.alert('最后确认', '提交后顾问将在 3 个工作日内电话联系你核实身份;核实通过后完成注销并短信告知。确定提交?', [
            { text: '取消', style: 'cancel' },
            { text: '提交注销申请', style: 'destructive', onPress: () => { void doDelete() } },
          ])
        },
      },
    ])
  }
  async function doDelete() {
    setDelBusy(true)
    try {
      const r = await cnAccountDelete()
      if (r.ok) Alert.alert('注销申请已提交', r.dedup ? '你近 24 小时内已提交过申请,已自动合并。' : '顾问将在 3 个工作日内电话联系你核实身份;核实通过后完成注销并短信告知。')
      else Alert.alert('提交失败', r.error || '请稍后再试,或通过公众号「白泽 Bayze」联系')
    } finally {
      setDelBusy(false)
    }
  }

  return (
    <ScrollView style={[s.wrap, { paddingTop: insets.top }]} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={s.title}>我的</Text>

      {/* 套餐与额度卡片 */}
      <View style={s.card}>
        <View style={s.planHead}>
          <Text style={s.planLabel}>{loading ? '加载中…' : (plan?.label || '体验版')}</Text>
          {plan?.expires ? (
            <Text style={[s.planExp, expiring && { color: C.amber }]}>
              {daysLeft! <= 0 ? '已到期' : `${daysLeft} 天后到期`}
            </Text>
          ) : <Text style={s.planExp}>{plan?.scope === 'day' ? '每日刷新' : '长期'}</Text>}
        </View>
        {plan && (
          <>
            <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` as `${number}%`, backgroundColor: pct >= 90 ? C.red : pct >= 70 ? C.amber : C.teal }]} /></View>
            <View style={s.planMeta}>
              <Text style={s.planMetaTx}>已用 {plan.used.toLocaleString('en-US')} / {plan.limit.toLocaleString('en-US')} 点({plan.scope === 'day' ? '今日' : '本月'})</Text>
              <Text style={[s.planMetaTx, { color: C.teal }]}>剩 {plan.remaining.toLocaleString('en-US')}</Text>
            </View>
          </>
        )}
        {expiring && !isIOS && (
          <TouchableOpacity style={s.renewBtn} onPress={() => Linking.openURL(CN_BASE + '/billing')} activeOpacity={0.8}>
            <Text style={s.renewTx}>⏰ 即将到期 · 去续费(微信支付自动开通)→</Text>
          </TouchableOpacity>
        )}
        {expiring && isIOS && (
          <View style={s.renewBtn}><Text style={s.renewTx}>⏰ 套餐即将到期</Text></View>
        )}
      </View>

      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.rowLabel}>手机号</Text>
          <Text style={s.rowVal}>{phone ? phone.slice(0, 3) + '****' + phone.slice(-4) : '—'}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>近 7 天调用</Text>
          <Text style={s.rowVal}>{loading ? <ActivityIndicator color={C.teal} /> : `${calls7} 次`}</Text>
        </View>
        <View style={[s.row, { borderBottomWidth: 0 }]}>
          <Text style={s.rowLabel}>近 7 天 tokens</Text>
          <Text style={s.rowVal}>{loading ? '…' : tokens7.toLocaleString('en-US')}</Text>
        </View>
      </View>

      {/* 网页版功能入口(含购买引导,iOS 提审口径整卡隐藏 —— Guideline 3.1.1) */}
      {!isIOS && (
        <>
          <Text style={s.sec}>完整功能</Text>
          <View style={s.card}>
            <TouchableOpacity style={s.row} onPress={() => Linking.openURL(CN_BASE + '/me')}>
              <Text style={s.rowLabel}>用量明细与充值记录</Text>
              <Text style={s.link}>网页版 ↗</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.row} onPress={() => Linking.openURL(CN_BASE + '/billing')}>
              <Text style={s.rowLabel}>续费与发票(微信支付)</Text>
              <Text style={s.link}>网页版 ↗</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={() => Linking.openURL(CN_BASE + '/team')}>
              <Text style={s.rowLabel}>我的企业/团队</Text>
              <Text style={s.link}>网页版 ↗</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 合规链接(双端保留:隐私政策/用户协议是审核必需,允许外链) */}
      <Text style={s.sec}>法律与隐私</Text>
      <View style={s.card}>
        <TouchableOpacity style={s.row} onPress={() => Linking.openURL(CN_BASE + '/privacy')}>
          <Text style={s.rowLabel}>隐私政策</Text>
          <Text style={s.link}>↗</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={() => Linking.openURL(CN_BASE + '/terms')}>
          <Text style={s.rowLabel}>用户服务协议</Text>
          <Text style={s.link}>↗</Text>
        </TouchableOpacity>
        {APP_ICP ? (
          <View style={[s.row, { borderBottomWidth: 0 }]}>
            <Text style={[s.rowLabel, { flex: 1 }]}>{`APP 备案:${APP_ICP}`}</Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity style={[s.btn, s.btnDanger]} onPress={logout}>
        <Text style={s.btnDangerTx}>退出登录</Text>
      </TouchableOpacity>

      {/* 账号注销(5.1.1(v):支持注册即须支持 App 内发起注销) */}
      <TouchableOpacity style={[s.btn, s.btnDanger, { marginTop: 8 }]} onPress={delAccount} disabled={delBusy} activeOpacity={0.8}>
        <Text style={s.btnDangerTx}>{delBusy ? '提交中…' : '注销账号'}</Text>
      </TouchableOpacity>

      <Text style={s.foot}>{`白泽 Bayze 大陆版 v${APP_VERSION} · 数据存储于境内`}</Text>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 22, fontWeight: '700', marginBottom: 14 },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 14 },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingBottom: 8 },
  planLabel: { color: C.teal, fontSize: 17, fontWeight: '700' },
  planExp: { color: C.muted, fontSize: 12 },
  bar: { height: 6, borderRadius: 99, backgroundColor: C.border, marginHorizontal: 14, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 99 },
  planMeta: { flexDirection: 'row', justifyContent: 'space-between', padding: 10, paddingHorizontal: 14 },
  planMetaTx: { color: C.muted, fontSize: 12 },
  renewBtn: { margin: 10, marginTop: 2, padding: 10, borderRadius: 10, backgroundColor: 'rgba(232,180,50,.08)', borderWidth: 1, borderColor: 'rgba(232,180,50,.3)', alignItems: 'center' },
  renewTx: { color: C.amber, fontSize: 12.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  rowLabel: { color: C.text, fontSize: 14.5 },
  rowVal: { color: C.muted, fontSize: 14 },
  link: { color: C.teal, fontSize: 13.5 },
  sec: { color: C.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 8, marginTop: 6 },
  btn: { borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10 },
  btnDanger: { backgroundColor: 'rgba(224,86,86,.08)', borderWidth: 1, borderColor: 'rgba(224,86,86,.3)' },
  btnDangerTx: { color: C.red, fontSize: 15, fontWeight: '600' },
  foot: { color: C.muted, fontSize: 11.5, textAlign: 'center', marginTop: 22 },
})
