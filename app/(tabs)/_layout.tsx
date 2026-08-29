import { Tabs } from 'expo-router'

const C = { bg2:'#111113', border:'#222228', teal:'#1AEBA8', muted:'#606070', text:'#E4E4EA' }

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown:        false,
      tabBarStyle:        { backgroundColor: C.bg2, borderTopColor: C.border, height: 58, paddingBottom: 8 },
      tabBarActiveTintColor:   C.teal,
      tabBarInactiveTintColor: C.muted,
      tabBarLabelStyle:   { fontSize: 11 },
    }}>
      <Tabs.Screen name="index"    options={{ title: 'Chat',     tabBarIcon: ({ color }) => <TabIcon name="chat"     color={color} /> }} />
      <Tabs.Screen name="tools"    options={{ title: 'Tools',    tabBarIcon: ({ color }) => <TabIcon name="tools"    color={color} /> }} />
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
