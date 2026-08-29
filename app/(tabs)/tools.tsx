// 实用工具 Tab(2026-08-29):把网页版免费工具(拍照识别/翻译/录音转写)作为手机端导流入口。
// 点卡片 → 用 app 已解析的可用域名(resolveBase,自动规避大陆 SNI 阻断)在系统浏览器打开对应工具页。
// 手机浏览器的文件选择框可直接调起相机/相册/选录音,所以无需原生相机代码即可拍照识别、选音频转写。
import { View, Text, TouchableOpacity, ScrollView, Linking, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { resolveBase } from '../../lib/api'

const C = { bg: '#0A0A0B', bg2: '#111113', border: '#222228', teal: '#1AEBA8', muted: '#8A8A99', text: '#E4E4EA', sub: '#9A9AA8' }

const TOOLS: { key: string; path: string; icon: keyof typeof Ionicons.glyphMap; title: string; desc: string }[] = [
  { key: 'ocr',        path: '/tools/ocr',        icon: 'scan-outline',     title: 'Scan & OCR',   desc: 'Photo, screenshot or PDF → text, fields & tables, export Excel / Word' },
  { key: 'translate',  path: '/tools/translate',  icon: 'language-outline', title: 'Translate',    desc: 'Translate documents with the layout kept, export Word' },
  { key: 'transcribe', path: '/tools/transcribe', icon: 'mic-outline',      title: 'Transcribe',   desc: 'Recording → transcript + AI meeting minutes' },
]

export default function ToolsScreen() {
  const insets = useSafeAreaInsets()
  async function open(path: string) {
    try {
      const base = await resolveBase()
      await Linking.openURL(base + path)
    } catch { /* 打不开静默,不阻塞 */ }
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 24, paddingBottom: 40 }}>
      <Text style={s.h1}>Tools</Text>
      <Text style={s.lede}>Free utilities — scan, translate and transcribe. Camera and files are supported; sign in to save results to your workspace.</Text>
      {TOOLS.map(t => (
        <TouchableOpacity key={t.key} style={s.card} onPress={() => open(t.path)} activeOpacity={0.8}>
          <View style={s.iconWrap}><Ionicons name={t.icon} size={22} color={C.teal} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardT}>{t.title}</Text>
            <Text style={s.cardD}>{t.desc}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.muted} />
        </TouchableOpacity>
      ))}
      <Text style={s.foot}>Opens in your browser.</Text>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  h1:   { color: C.text, fontSize: 26, fontWeight: '800', marginBottom: 6 },
  lede: { color: C.sub, fontSize: 13, lineHeight: 20, marginBottom: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.bg2, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(26,235,168,0.10)', alignItems: 'center', justifyContent: 'center' },
  cardT: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 3 },
  cardD: { color: C.sub, fontSize: 12, lineHeight: 17 },
  foot: { color: C.muted, fontSize: 11, marginTop: 8 },
})
