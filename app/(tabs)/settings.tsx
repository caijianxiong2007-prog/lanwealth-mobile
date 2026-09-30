// 大陆版设置页(cn 分支,v1 精简版):账号信息 + 近 7 天用量摘要 + 登出。
// 完整账单/套餐管理在网页版 app.lanwealth.cn(「我的」与「续费与发票」)。
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getCnSession, cnLogout, cnUsage, CN_BASE, type CnUsage } from '../../lib/cnApi'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', red: '#e05656',
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const [phone, setPhone]         = useState('')
  const [usage, setUsage]         = useState<CnUsage | null>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const s = await getCnSession()
      if (alive) setPhone(s?.phone || '')
      try {
        const u = await cnUsage()
        if (alive) setUsage(u)
      } catch {}
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // 近 7 天:调用次数与 tokens 汇总
  const week = (usage || []).filter((r) => r.day >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const calls7 = week.reduce((s, r) => s + r.calls, 0)
  const tokens7 = week.reduce((s, r) => s + Number(r.prompt_tokens || 0) + Number(r.completion_tokens || 0), 0)

  async function logout() {
    await cnLogout()
    await AsyncStorage.removeItem('cn_chat_history_v1').catch(() => {})
    const { useRouter } = await import('expo-router')
    useRouter().replace('/(auth)/login')
  }

  return (
    <ScrollView style={[s.wrap, { paddingTop: insets.top }]} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={s.title}>我的</Text>

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

      <Text style={s.sec}>完整功能</Text>
      <View style={s.card}>
        <TouchableOpacity style={s.row} onPress={() => Linking.openURL(CN_BASE + '/me')}>
          <Text style={s.rowLabel}>套餐与用量明细</Text>
          <Text style={s.link}>网页版 ↗</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.row} onPress={() => Linking.openURL(CN_BASE + '/billing')}>
          <Text style={s.rowLabel}>续费与发票</Text>
          <Text style={s.link}>网页版 ↗</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={() => Linking.openURL(CN_BASE + '/team')}>
          <Text style={s.rowLabel}>我的企业/团队</Text>
          <Text style={s.link}>网页版 ↗</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[s.btn, s.btnDanger]} onPress={logout}>
        <Text style={s.btnDangerTx}>退出登录</Text>
      </TouchableOpacity>

      <Text style={s.foot}>白泽 Bayze 大陆版 v0.1.0 · 数据存储于境内</Text>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 22, fontWeight: '700', marginBottom: 14 },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 14 },
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
