import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Image, Linking, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CN_DEMO_SCENARIOS, getDemoScenario } from '../../lib/cnDemo'

const C = { bg: '#0a0f0d', panel: '#101815', border: '#22302a', text: '#e6efe9', muted: '#9bb0a3', teal: '#1aeba8' }

export default function DemoScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<'chat' | 'account'>('chat')
  const [scenarioId, setScenarioId] = useState(CN_DEMO_SCENARIOS[0].id)
  const [ran, setRan] = useState(false)
  const [copied, setCopied] = useState(false)
  const scenario = getDemoScenario(scenarioId) ?? CN_DEMO_SCENARIOS[0]
  function select(id: string) { setScenarioId(id); setRan(false); setCopied(false) }
  function reset() { setRan(false); setCopied(false) }
  async function copy() {
    try { await Clipboard.setStringAsync(scenario.result); setCopied(true) }
    catch { Alert.alert('复制失败', '请重试') }
  }
  return (
    <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.header}>
        <Image source={require('../../assets/bayze-logo.png')} style={s.logo} />
        <View style={s.flex}><Text style={s.brand}>白泽 Bayze</Text><Text style={s.small}>大陆版 · 演示模式</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="退出演示并登录" onPress={() => router.replace('/(auth)/login')} style={s.headerButton}>
          <Text style={s.link}>登录</Text><Ionicons name="log-in-outline" size={20} color={C.teal} />
        </TouchableOpacity>
      </View>
      <View style={s.notice}><Ionicons name="information-circle-outline" size={18} color={C.muted} /><Text style={[s.small, s.flex]}>预置示例，仅在本机展示，不调用真实模型、不上传资料、不扣额度。</Text></View>
      <ScrollView contentContainerStyle={s.content}>
        {tab === 'chat' ? <>
          <View style={s.titleRow}><Text style={s.title}>办公对话示例</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="重置示例对话" onPress={reset} style={s.iconButton}><Ionicons name="refresh-outline" size={22} color={C.muted} /></TouchableOpacity></View>
          <View style={s.scenarios}>{CN_DEMO_SCENARIOS.map(item => <TouchableOpacity key={item.id} accessibilityRole="button" accessibilityState={{ selected: scenarioId === item.id }} onPress={() => select(item.id)} style={[s.scenario, scenarioId === item.id && s.selected]}><Text style={scenarioId === item.id ? s.link : s.small}>{item.title}</Text></TouchableOpacity>)}</View>
          <View style={s.source}><View style={s.titleRow}><Ionicons name="document-text-outline" size={19} color={C.muted} /><Text style={[s.small, s.flex]}>{scenario.sourceTitle}</Text></View><Text style={s.body}>{scenario.source}</Text></View>
          <View style={s.userBubble}><Text style={s.body}>{scenario.request}</Text></View>
          {!ran ? <TouchableOpacity accessibilityRole="button" onPress={() => setRan(true)} style={s.run}><Ionicons name="play-outline" size={18} color="#04140e" /><Text style={s.runText}>查看示例结果</Text></TouchableOpacity> : <View style={s.answer}><Text style={s.answerLabel}>Bayze · 预置示例结果</Text><Text selectable style={s.body}>{scenario.result}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="复制示例结果" onPress={copy} style={s.copy}><Ionicons name="copy-outline" size={17} color={C.teal} /><Text style={s.link}>{copied ? '已复制' : '复制结果'}</Text></TouchableOpacity></View>}
        </> : <>
          <Text style={s.title}>演示账户</Text>
          <View style={s.accountRow}><Text style={s.body}>账户状态</Text><Text style={s.link}>未登录 · 本机示例</Text></View>
          <View style={s.accountRow}><Text style={s.body}>额度</Text><Text style={s.small}>示例不计费</Text></View>
          <Text style={s.accountNote}>此模式不创建账户，不保存或同步会话。登录后可使用真实AI对话、附件、语音输入及账户管理，实际功能以账户权限为准。</Text>
          <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL('https://app.lanwealth.cn/privacy')} style={s.accountRow}><Text style={s.body}>隐私政策</Text><Ionicons name="open-outline" size={18} color={C.teal} /></TouchableOpacity>
          <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL('https://app.lanwealth.cn/terms')} style={s.accountRow}><Text style={s.body}>用户服务协议</Text><Ionicons name="open-outline" size={18} color={C.teal} /></TouchableOpacity>
          <Text style={s.accountNote}>APP 备案：沪ICP备2026047002号-3A</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={s.run}><Ionicons name="log-in-outline" size={20} color="#04140e" /><Text style={s.runText}>返回注册与登录</Text></TouchableOpacity>
        </>}
      </ScrollView>
      <View style={s.tabs}>
        <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: tab === 'chat' }} onPress={() => setTab('chat')} style={s.tab}><Ionicons name="chatbubble-outline" size={22} color={tab === 'chat' ? C.teal : C.muted} /><Text style={tab === 'chat' ? s.link : s.small}>对话</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: tab === 'account' }} onPress={() => setTab('account')} style={s.tab}><Ionicons name="person-outline" size={22} color={tab === 'account' ? C.teal : C.muted} /><Text style={tab === 'account' ? s.link : s.small}>我的</Text></TouchableOpacity>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  logo: { width: 40, height: 40, borderRadius: 8 }, brand: { fontSize: 17, fontWeight: '700', color: C.text },
  small: { fontSize: 13, lineHeight: 20, color: C.muted }, link: { fontSize: 14, color: C.teal },
  headerButton: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', gap: 6, alignItems: 'center' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.panel },
  content: { padding: 16, paddingBottom: 28 }, title: { color: C.text, fontSize: 20, fontWeight: '700', flex: 1, marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scenarios: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  scenario: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: C.border, justifyContent: 'center' },
  selected: { borderColor: C.teal, backgroundColor: '#112b21' },
  source: { padding: 14, borderWidth: 1, borderColor: C.border, borderRadius: 8, marginBottom: 18 },
  body: { color: C.text, fontSize: 15, lineHeight: 25 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '94%', borderRadius: 8, padding: 13, backgroundColor: '#163b2d', marginBottom: 16 },
  answer: { borderLeftWidth: 2, borderLeftColor: C.teal, paddingLeft: 13 },
  answerLabel: { color: C.muted, fontSize: 12, marginBottom: 10 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, alignSelf: 'flex-start', marginTop: 10 },
  run: { minHeight: 46, borderRadius: 6, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.teal },
  runText: { color: '#04140e', fontSize: 15, fontWeight: '700' },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, minHeight: 52, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 12 },
  accountNote: { color: C.muted, fontSize: 13, lineHeight: 22, marginVertical: 18 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.panel },
  tab: { flex: 1, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 5 },
})
