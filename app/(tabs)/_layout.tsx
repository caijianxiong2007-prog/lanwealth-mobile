// 大陆版 Tab 布局(cn 分支):对话 + 我的(v1 去掉 Tools 导流页,网页版入口在设置页)
// 企业专属门(App Store 3.1.1/3.1.3(c),2026-11-02 老板拍板):iOS 版服务仅面向
// 企业/组织账户(由企业采购开通,无需 IAP);无企业身份的账户进入引导页(指引联系
// 企业管理员)。2026-11-06(2.3.10+3.1.1 四审):文案去除其他平台引用与消费者引流,
// 纯企业口径。Android 端不做此门(照常),故仅 iOS 生效。
import { Tabs, useRouter, type ErrorBoundaryProps } from 'expo-router'
import { ActivityIndicator, Linking, Platform, Text, TouchableOpacity, View } from 'react-native'
import { useEffect, useState } from 'react'
import { cnWorkSetup, getCnSession, cnLogout } from '../../lib/cnApi'
import { wipeConversations } from '../../lib/cnConversations'

const C = { bg2: '#101815', border: '#22302a', teal: '#1aeba8', muted: '#8fa89b' }

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <View style={{ flex: 1, backgroundColor: C.bg2, justifyContent: 'center', padding: 24 }}>
    <Text style={{ color: '#e6efe9', fontSize: 18, marginBottom: 16 }}>工作区加载失败</Text>
    <TouchableOpacity accessibilityRole="button" onPress={retry} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: C.teal, fontSize: 16 }}>重新加载</Text>
    </TouchableOpacity>
  </View>
}

type Gate = 'pass' | 'checking' | 'non-enterprise' | 'error'

// iOS 企业身份检查:fin_setup_get 走服务端鉴权(缺省取账号 active_tenant);
// "未开通企业/无上下文"类报错 → 引导页;网络类报错 → 可重试的错误态(不误伤企业用户)。
function useIosEnterpriseGate(): Gate {
  const [gate, setGate] = useState<Gate>(Platform.OS === 'ios' ? 'checking' : 'pass')
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    let alive = true
    ;(async () => {
      setGate('checking')
      const s = await getCnSession()
      if (!s) { if (alive) setGate('pass'); return }   // 无会话:根布局守卫会跳登录页,这里放行
      try {
        await cnWorkSetup()
        if (alive) setGate('pass')
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (alive) setGate(/企业|开通|上下文|成员|权限/.test(msg) ? 'non-enterprise' : 'error')
      }
    })()
    return () => { alive = false }
  }, [])
  return gate
}

function EnterpriseGuide({ onSwitch }: { onSwitch: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0f0d', justifyContent: 'center', padding: 28 }}>
      <Text style={{ color: '#e6efe9', fontSize: 22, fontWeight: '700', marginBottom: 14 }}>白泽 App 面向企业用户</Text>
      <Text style={{ color: C.muted, fontSize: 14.5, lineHeight: 22, marginBottom: 10 }}>
        白泽 App 的 AI 对话与企业工作台服务面向企业、组织用户,由企业统一开通(企业合同采购)。
      </Text>
      <Text style={{ color: C.muted, fontSize: 14.5, lineHeight: 22, marginBottom: 26 }}>
        当前登录的账号未开通企业空间。请联系贵司管理员开通企业空间,或切换到已加入企业的账号。
      </Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => Linking.openURL('https://app.lanwealth.cn')} style={{ backgroundColor: 'rgba(26,235,168,.12)', borderWidth: 1, borderColor: C.teal, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ color: C.teal, fontSize: 15.5 }}>打开白泽网页版</Text>
      </TouchableOpacity>
      <Text style={{ color: C.muted, fontSize: 12.5, lineHeight: 19, marginBottom: 14, textAlign: 'center' }}>
        网页版与 App 使用同一企业账号,供企业成员在电脑上处理工作。
      </Text>
      <TouchableOpacity accessibilityRole="button" onPress={onSwitch} style={{ paddingVertical: 13, alignItems: 'center' }}>
        <Text style={{ color: C.muted, fontSize: 14.5 }}>切换账号 / 退出登录</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function TabLayout() {
  const router = useRouter()
  const gate = useIosEnterpriseGate()

  // 引导页的切换账号:与设置页登出同款清理(本机会话清空+回登录页)
  async function guideLogout() {
    try {
      const s = await getCnSession()
      if (s) await wipeConversations(s.phone)
      await cnLogout()
    } catch {}
    router.replace('/(auth)/login')
  }

  if (gate === 'checking') {
    return <View style={{ flex: 1, backgroundColor: '#0a0f0d', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.teal} accessibilityLabel="正在检查企业账户" />
    </View>
  }
  if (gate === 'error') {
    return <View style={{ flex: 1, backgroundColor: '#0a0f0d', justifyContent: 'center', padding: 28 }}>
      <Text style={{ color: '#e6efe9', fontSize: 17, marginBottom: 12 }}>企业账户检查失败</Text>
      <Text style={{ color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 24 }}>网络异常,暂时无法确认你的企业身份。请检查网络后重试。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={{ paddingVertical: 12, alignItems: 'center' }}>
        <Text style={{ color: C.teal, fontSize: 15 }}>重试(返回登录)</Text>
      </TouchableOpacity>
    </View>
  }
  if (gate === 'non-enterprise') return <EnterpriseGuide onSwitch={guideLogout} />

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: C.bg2, borderTopColor: C.border, height: 58, paddingBottom: 8 },
      tabBarActiveTintColor: C.teal,
      tabBarInactiveTintColor: C.muted,
      tabBarLabelStyle: { fontSize: 11 },
    }}>
      <Tabs.Screen name="index"      options={{ title: '对话',    tabBarIcon: ({ color }) => <TabIcon name="chat" color={color} /> }} />
      <Tabs.Screen name="workbench" options={{ title: '工作台',  tabBarIcon: ({ color }) => <TabIcon name="work" color={color} /> }} />
      <Tabs.Screen name="settings"   options={{ title: '我的',   tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} /> }} />
    </Tabs>
  )
}

function TabIcon({ name, color }: { name: string; color: string }) {
  const { Text } = require('react-native')
  const icons: Record<string, string> = { chat: '💬', work: '🗂️', settings: '👤' }
  return <Text style={{ fontSize: 20 }}>{icons[name] ?? '·'}</Text>
}
