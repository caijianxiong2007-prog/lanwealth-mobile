// Work 记录页(INT10,2026-10-25)——新版对话底座(work 协议)入口。
// 旧 Chat 页保持不动,两入口并存灰度(与大陆版 /chat ↔ /workbench 同策略)。
import { View, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WorkThreadsCard } from '../../components/WorkThreadsCard'

const C = { bg: '#0d0f1c', text: '#e8eaf6', muted: '#80849e' }

export default function WorkScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <Text style={s.hint}>消息级历史 · 跨设备同步 · 新对话底座预览(与 Chat 并存)</Text>
      <WorkThreadsCard />
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 12, paddingBottom: 8 },
  hint: { color: C.muted, fontSize: 11, marginBottom: 8, textAlign: 'center' },
})
