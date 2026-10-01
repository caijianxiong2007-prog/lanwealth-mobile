// 大陆版聊天页(cn 分支,v0.3):
//   · 5 个已备案国产模型(cn-chat);SSE 流式对话(cn-stream /stream,失败自动降级非流式)
//   · 多会话本地管理(按手机号命名空间,仅存本机);服务端按活跃企业岗位自动注入人设、
//     额度闸门/保密对话企业开关同网页端
//   · 附件:选文档 → 服务端提取文本(PDF/DOCX/TXT,直传不入库)→ 作为本轮上下文注入
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { CN_MODELS, cnChat, cnStreamChat, cnStopStream, cnLogout, getCnSession, cnFileExtract, CN_USER_STOP, type CnMessage } from '../../lib/cnApi'
import {
  loadConversations, upsertConversation, dropConversation, wipeConversations,
  createConversationId, titleFrom, type CnConversation,
} from '../../lib/cnConversations'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', tealDim: 'rgba(26,235,168,.1)', red: '#e05656',
}

type Bubble = { role: 'user' | 'assistant'; content: string; ts: number }

export default function ChatScreen() {
  const insets    = useSafeAreaInsets()
  const [messages, setMessages] = useState<Bubble[]>([])
  const [input, setInput]       = useState('')
  const [model, setModel]       = useState(CN_MODELS[0].id)
  const [busy, setBusy]         = useState(false)
  const [showModels, setShowModels] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory]   = useState<CnConversation[]>([])
  const [convId, setConvId]     = useState<string | null>(null)
  const [attach, setAttach]     = useState<{ name: string; chars: number; text: string } | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const listRef  = useRef<FlatList<Bubble>>(null)
  const abortRef = useRef<AbortController | null>(null)   // 保留给非流式降级路径;流式停止走 cnStopStream
  const cnActiveCleanup = () => { abortRef.current = null }

  // 启动:取本地会话列表;有历史则续接最近一条,否则空白新对话
  useEffect(() => {
    ;(async () => {
      const s = await getCnSession()
      if (!s) return
      const list = await loadConversations(s.phone)
      setHistory(list)
      if (list.length) {
        setConvId(list[0].id)
        setModel(list[0].model || CN_MODELS[0].id)
        setMessages(list[0].messages.map((m, i) => ({ role: m.role as 'user' | 'assistant', content: m.content, ts: i })))
      }
    })()
  }, [])

  async function openHistory() {
    const s = await getCnSession()
    if (s) setHistory(await loadConversations(s.phone))
    setShowHistory(true)
  }

  async function pickConversation(id: string) {
    if (busy) return
    const c = history.find((x) => x.id === id)
    if (c) {
      setConvId(c.id); setModel(c.model || CN_MODELS[0].id)
      setMessages(c.messages.map((m, i) => ({ role: m.role as 'user' | 'assistant', content: m.content, ts: i })))
    }
    setShowHistory(false)
  }

  function newConversation() {
    if (busy) return
    setConvId(null); setMessages([]); setShowHistory(false); setShowModels(false)
  }

  async function removeConversation(id: string) {
    const s = await getCnSession()
    if (!s) return
    const list = await dropConversation(s.phone, id)
    setHistory(list)
    if (id === convId) newConversation()
  }

  const persist = useCallback((_next: Bubble[]) => {}, [])   // 兼容占位(实际持久化走 persistConv)
  async function persistConv(next: Bubble[]) {
    const s = await getCnSession()
    if (!s || !next.length) return
    const conv: CnConversation = {
      id: convId || createConversationId(),
      title: titleFrom(next.find((m) => m.role === 'user')?.content || '新对话'),
      model,
      messages: next.map((m) => ({ role: m.role, content: m.content })),
      updatedAt: Date.now(),
    }
    setConvId(conv.id)
    setHistory(await upsertConversation(s.phone, conv))
  }

  async function pickAttachment() {
    if (attachBusy || busy) return
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'text/plain', 'text/markdown', 'text/csv', 'text/comma-separated-values'],
      copyToCacheDirectory: true,
    })
    if (r.canceled || !r.assets?.length) return
    const f = r.assets[0]
    if ((f.size || 0) > 10 * 1024 * 1024) { Alert.alert('文件过大', '请选择 10MB 以内的文档'); return }
    setAttachBusy(true)
    try {
      const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 })
      const out = await cnFileExtract(f.name || '附件', b64)
      if (!out.ok || !out.text) { Alert.alert('附件提取失败', out.error || '请换用文本内容粘贴'); return }
      setAttach({ name: f.name || '附件', chars: out.chars || out.text.length, text: out.text })
    } catch (e) {
      Alert.alert('附件读取失败', e instanceof Error ? e.message : '请重试')
    } finally {
      setAttachBusy(false)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const userB: Bubble = { role: 'user', content: text, ts: Date.now() }
    const next = [...messages, userB]
    setMessages(next); void persistConv(next); setInput(''); setBusy(true)
    const apiMsgs: CnMessage[] = next.slice(-20).map((m) => ({ role: m.role, content: m.content }))
    // 附件上下文注入(与网页端同款:用一次即清)
    if (attach) {
      apiMsgs.unshift({ role: 'system', content: '以下是用户上传的文件内容,作为回答的参考依据:\n\n' + attach.text.slice(0, 6000) })
      setAttach(null)
    }

    // 流式优先(cn-stream SSE 逐字);一字未出即失败 → 降级非流式;中途断流 → 保留已生成
    let acc = ''
    let streamed = false
    try {
      for await (const delta of cnStreamChat(model, apiMsgs)) {
        streamed = true
        acc += delta
        const draft = [...next, { role: 'assistant' as const, content: acc, ts: Date.now() }]
        setMessages(draft)
      }
      const finalMsgs = [...next, { role: 'assistant' as const, content: acc || '(空响应)', ts: Date.now() }]
      setMessages(finalMsgs); void persistConv(finalMsgs)
    } catch (e) {
      const err = e as Error & { status?: number; quota?: boolean }
      if (err.message === CN_USER_STOP) {
        // 用户主动停止:保留已生成部分
        if (acc) { const kept = [...next, { role: 'assistant' as const, content: acc, ts: Date.now() }]; setMessages(kept); void persistConv(kept) }
      } else if (!streamed) {
        // 流式通道不可用/前置报错 → 非流式降级(服务端前置校验错误会在这里重新抛出)
        try {
          const r = await cnChat(model, apiMsgs)
          const finalMsgs = [...next, { role: 'assistant' as const, content: r.content, ts: Date.now() }]
          setMessages(finalMsgs); void persistConv(finalMsgs)
        } catch (e2) {
          const err2 = e2 as Error & { status?: number; quota?: boolean }
          if (err2.status === 401) {
            await cnLogout()
            const { useRouter } = await import('expo-router')
            useRouter().replace('/(auth)/login')
            return
          }
          const withErr = [...next, { role: 'assistant' as const, content: '⚠️ ' + (err2.message || '网络异常,请重试'), ts: Date.now() }]
          setMessages(withErr); void persistConv(withErr)
          if (err2.quota) Alert.alert('额度已用完', err2.message)
        }
      } else {
        // 中途断流:保留已生成内容并标注
        const kept = [...next, { role: 'assistant' as const, content: acc + '\n\n(网络中断,内容可能不完整)', ts: Date.now() }]
        setMessages(kept); void persistConv(kept)
      }
    } finally {
      setBusy(false); cnActiveCleanup()
    }
  }

  function stop() { cnStopStream() }

  function clearChat() {
    Alert.alert('清空当前对话', '确定清空?(仅清本机当前会话)', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: newConversation },
    ])
  }

  const modelInfo = CN_MODELS.find((m) => m.id === model) || CN_MODELS[0]

  return (
    <KeyboardAvoidingView style={[s.wrap, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 顶栏:历史 / 模型选择 / 新对话 */}
      <View style={s.topbar}>
        <TouchableOpacity style={s.modelBtn} onPress={openHistory} activeOpacity={0.8}>
          <Text style={s.modelTx}>🕘 历史{history.length ? ` ${history.length}` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.modelBtn} onPress={() => setShowModels((v) => !v)} activeOpacity={0.8}>
          <Text style={s.modelTx}>🤖 {modelInfo.name} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.clearBtn} onPress={newConversation} disabled={busy}>
          <Text style={s.clearTx}>＋ 新对话</Text>
        </TouchableOpacity>
      </View>

      {/* 历史抽屉 */}
      {showHistory && (
        <View style={s.histMask} onTouchEnd={() => setShowHistory(false)}>
          <View style={s.histPanel} onTouchEnd={(e) => e.stopPropagation()}>
            <Text style={s.histTitle}>历史对话(仅存本机)</Text>
            <FlatList
              data={history}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 380 }}
              ListEmptyComponent={<Text style={s.histEmpty}>还没有历史对话</Text>}
              renderItem={({ item }) => (
                <View style={[s.histRow, item.id === convId && s.histRowOn]}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => pickConversation(item.id)}>
                    <Text style={s.histName} numberOfLines={1}>{item.title || '新对话'}</Text>
                    <Text style={s.histMeta}>{CN_MODELS.find((m) => m.id === item.model)?.name || item.model} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.histDel} onPress={() => removeConversation(item.id)}>
                    <Text style={{ color: C.red, fontSize: 12 }}>删除</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </View>
      )}

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

      {/* 附件预览条 */}
      {attach && (
        <View style={s.attachBar}>
          <Text style={s.attachTx} numberOfLines={1}>📎 {attach.name} · {attach.chars} 字</Text>
          <TouchableOpacity onPress={() => setAttach(null)} style={{ padding: 4 }}>
            <Text style={{ color: C.red, fontSize: 12 }}>✕ 移除</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 输入区 */}
      <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {attachBusy ? (
          <TouchableOpacity style={s.attachBtn} activeOpacity={0.8}>
            <ActivityIndicator size="small" color={C.teal} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.attachBtn} onPress={pickAttachment} disabled={busy} activeOpacity={0.8}>
            <Text style={{ fontSize: 18 }}>📎</Text>
          </TouchableOpacity>
        )}
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
  histMask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.55)', zIndex: 30, justifyContent: 'center', padding: 20 },
  histPanel: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, maxHeight: 460 },
  histTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  histEmpty: { color: C.muted, fontSize: 13, textAlign: 'center', padding: 20 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginBottom: 4 },
  histRowOn: { backgroundColor: C.tealDim },
  histName: { color: C.text, fontSize: 13.5 },
  histMeta: { color: C.muted, fontSize: 11, marginTop: 2 },
  histDel: { padding: 8 },
  attachBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  attachBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.card, borderWidth: 1, borderColor: 'rgba(26,235,168,.25)', borderRadius: 10 },
  attachTx: { color: C.text, fontSize: 12, flex: 1 },
})
