// 大陆版 Tab 布局(cn 分支):对话 + 我的(v1 去掉 Tools 导流页,网页版入口在设置页)
import { Tabs } from 'expo-router'

const C = { bg2: '#101815', border: '#22302a', teal: '#1aeba8', muted: '#8fa89b' }

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: C.bg2, borderTopColor: C.border, height: 58, paddingBottom: 8 },
      tabBarActiveTintColor: C.teal,
      tabBarInactiveTintColor: C.muted,
      tabBarLabelStyle: { fontSize: 11 },
    }}>
      <Tabs.Screen name="index"    options={{ title: '对话',  tabBarIcon: ({ color }) => <TabIcon name="chat" color={color} /> }} />
      <Tabs.Screen name="tools"    options={{ href: null,  title: 'Tools', tabBarIcon: ({ color }) => <TabIcon name="tools" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: '我的',  tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} /> }} />
    </Tabs>
  )
}

function TabIcon({ name, color }: { name: string; color: string }) {
  const { Text } = require('react-native')
  const icons: Record<string, string> = { chat: '💬', tools: '🧰', settings: '👤' }
  return <Text style={{ fontSize: 20 }}>{icons[name] ?? '·'}</Text>
}
