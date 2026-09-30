// 大陆版聊天页(cn 分支,v1 精简版):
//   · 5 个已备案国产模型(cn-chat);非流式对话(SSE 流式后续版本接入)
//   · 单会话 + 本地历史(AsyncStorage);服务端按活跃企业岗位自动注入人设、额度闸门同网页端
//   · 国际版 1698 行的附件/BYOK/客户关联等能力留在 main 分支,后续按需回移
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CN_MODELS, cnChat, cnLogout, type CnMessage } from '../../lib/cnApi'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', tealDim: 'rgba(26,235,168,.1)', red: '#e05656',
}
const HISTORY_KEY = 'cn_chat_history_v1'

type Bubble = { role: 'user' | 'assistant'; content: string; ts: number }

export default function ChatScreen() {
  const insets    = useSafeAreaInsets()
  const [messages, setMessages] = useState<Bubble[]>([])
  const [input, setInput]       = useState('')
  const [model, setModel]       = useState(CN_MODELS[0].id)
  const [busy, setBusy]         = useState(false)
  const [showModels, setShowModels] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const listRef  = useRef<FlatList<Bubble>>(null)

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((raw) => {
      if (raw) { try { setMessages(JSON.parse(raw)) } catch {} }
    }).catch(() => {})
  }, [])

  const persist = useCallback((next: Bubble[]) => {
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(-200))).catch(() => {})
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const userB: Bubble = { role: 'user', content: text, ts: Date.now() }
    const next = [...messages, userB]
    setMessages(next); persist(next); setInput(''); setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const apiMsgs: CnMessage[] = next.slice(-20).map((m) => ({ role: m.role, content: m.content }))
      const r = await cnChat(model, apiMsgs, { signal: ctrl.signal })
      const withReply = [...next, { role: 'assistant' as const, content: r.content, ts: Date.now() }]
      setMessages(withReply); persist(withReply)
    } catch (e) {
      const err = e as Error & { status?: number; quota?: boolean }
      if (ctrl.signal.aborted) {
        // 用户主动停止:保留已有内容,不加错误泡
      } else if (err.status === 401) {
        await cnLogout()
        const { useRouter } = await import('expo-router')
        useRouter().replace('/(auth)/login')
        return
      } else {
        const withErr = [...next, { role: 'assistant' as const, content: '⚠️ ' + (err.message || '网络异常,请重试'), ts: Date.now() }]
        setMessages(withErr); persist(withErr)
        if (err.quota) Alert.alert('额度已用完', err.message)
      }
    } finally {
      setBusy(false); abortRef.current = null
    }
  }

  function stop() { abortRef.current?.abort() }

  function clearChat() {
    Alert.alert('清空对话', '确定清空当前对话记录?(仅清本机)', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: () => { setMessages([]); persist([]) } },
    ])
  }

  const modelInfo = CN_MODELS.find((m) => m.id === model) || CN_MODELS[0]

  return (
    <KeyboardAvoidingView style={[s.wrap, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 顶栏:模型选择 + 清空 */}
      <View style={s.topbar}>
        <TouchableOpacity style={s.modelBtn} onPress={() => setShowModels((v) => !v)} activeOpacity={0.8}>
          <Text style={s.modelTx}>🤖 {modelInfo.name} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.clearBtn} onPress={clearChat}>
          <Text style={s.clearTx}>清空</Text>
        </TouchableOpacity>
      </View>

      {showModels && (
        <View style={s.modelPanel}>
          {CN_MODELS.map((m) => (
            <TouchableOpacity key={m.id} style={[s.modelRow, m.id === model && s.modelRowOn]} onPress={() => { setModel(m.id); setShowModels(false) }}>
              <Text style={[s.modelRowTx, m.id === model && { color: C.teal, fontWeight: '700' }]}>{m.name}</Text>
              <Text style={s.modelRowTag}>{m.tag}{m.free ? ' · 免费' : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 消息列表 */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        style={s.list}
        contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 36 }}>🦄</Text>
            <Text style={s.emptyTx}>你好,我是白泽 AI 助手。写作、分析、翻译、编程都能帮上忙。</Text>
            <Text style={s.emptySub}>已备案国产大模型 · 数据存储于境内</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : s.bubbleAi]}>
            <Text style={item.role === 'user' ? s.bubbleUserTx : s.bubbleAiTx}>{item.content}</Text>
          </View>
        )}
      />

      {/* 输入区 */}
      <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={s.input}
          placeholder="输入问题…"
          placeholderTextColor={C.muted}
          multiline
          value={input}
          onChangeText={setInput}
        />
        {busy ? (
          <TouchableOpacity style={[s.sendBtn, { backgroundColor: C.red }]} onPress={stop} activeOpacity={0.8}>
            <Text style={s.sendTx}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.sendBtn} onPress={send} disabled={!input.trim()} activeOpacity={0.8}>
            <Text style={s.sendTx}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  modelBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  modelTx: { color: C.text, fontSize: 13 },
  clearBtn: { marginLeft: 'auto', padding: 8 },
  clearTx: { color: C.muted, fontSize: 13 },
  modelPanel: { backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border, padding: 6 },
  modelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 11, borderRadius: 8 },
  modelRowOn: { backgroundColor: C.tealDim },
  modelRowTx: { color: C.text, fontSize: 14 },
  modelRowTag: { color: C.muted, fontSize: 12 },
  list: { flex: 1 },
  empty: { alignItems: 'center', marginTop: 80, padding: 30 },
  emptyTx: { color: C.text, fontSize: 14, textAlign: 'center', marginTop: 14, lineHeight: 22 },
  emptySub: { color: C.muted, fontSize: 12, marginTop: 8 },
  bubble: { borderRadius: 12, padding: 11, marginBottom: 10, maxWidth: '86%' },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: C.tealDim, borderWidth: 1, borderColor: 'rgba(26,235,168,.25)' },
  bubbleAi: { alignSelf: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  bubbleUserTx: { color: C.text, fontSize: 14, lineHeight: 21 },
  bubbleAiTx: { color: C.text, fontSize: 14, lineHeight: 21 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  input: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, color: C.text, fontSize: 15, padding: 11, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  sendTx: { color: '#04140e', fontSize: 19, fontWeight: '700' },
})
