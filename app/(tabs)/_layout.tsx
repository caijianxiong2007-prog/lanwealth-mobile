import { useState, useEffect } from 'react'
import { Tabs } from 'expo-router'
import { getCachedConfig, refreshConfig } from '../../lib/appConfig'

const C = { bg2:'#111113', border:'#222228', teal:'#1AEBA8', muted:'#606070', text:'#E4E4EA' }

export default function TabLayout() {
  // Tools Tab 显示由远程配置控制(零发版点亮):默认显示,服务端下发 tools:false 才隐藏。
  const [toolsEnabled, setToolsEnabled] = useState(true)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const cached = await getCachedConfig()
      if (alive) setToolsEnabled(cached.tools)
      const fresh = await refreshConfig()
      if (alive && fresh) setToolsEnabled(fresh.tools)
    })()
    return () => { alive = false }
  }, [])

  return (
    <Tabs screenOptions={{
      headerShown:        false,
      tabBarStyle:        { backgroundColor: C.bg2, borderTopColor: C.border, height: 58, paddingBottom: 8 },
      tabBarActiveTintColor:   C.teal,
      tabBarInactiveTintColor: C.muted,
      tabBarLabelStyle:   { fontSize: 11 },
    }}>
      <Tabs.Screen name="index"    options={{ title: 'Chat',     tabBarIcon: ({ color }) => <TabIcon name="chat"     color={color} /> }} />
      {/* href:null 时从 Tab 栏移除(远程关时隐藏,而非显示默认样式) */}
      <Tabs.Screen name="tools"    options={{ title: 'Tools',    href: toolsEnabled ? undefined : null, tabBarIcon: ({ color }) => <TabIcon name="tools" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} /> }} />
    </Tabs>
  )
}

function TabIcon({ name, color }: { name: string; color: string }) {
  // Simple SVG-less icons via text
  const icons: Record<string, string> = { chat: '💬', tools: '🧰', settings: '⚙️' }
  const { Text } = require('react-native')
  return <Text style={{ fontSize: 20 }}>{icons[name] ?? '·'}</Text>
}
