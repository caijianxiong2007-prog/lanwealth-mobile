// 大陆版 Tab 布局(cn 分支):对话 + 我的(v1 去掉 Tools 导流页,网页版入口在设置页)
import { Tabs, type ErrorBoundaryProps } from 'expo-router'
import { Text, TouchableOpacity, View } from 'react-native'

const C = { bg2: '#101815', border: '#22302a', teal: '#1aeba8', muted: '#8fa89b' }

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <View style={{ flex: 1, backgroundColor: C.bg2, justifyContent: 'center', padding: 24 }}>
    <Text style={{ color: '#e6efe9', fontSize: 18, marginBottom: 16 }}>工作区加载失败</Text>
    <TouchableOpacity accessibilityRole="button" onPress={retry} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: C.teal, fontSize: 16 }}>重新加载</Text>
    </TouchableOpacity>
  </View>
}

export default function TabLayout() {
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
