// 大陆版手机端 · 工作记录卡(CN10 UI 接入,2026-10-22)
// 嵌入工作台(workbench.tsx)的自包含组件:新版 work 协议会话——
// 个人空间线程列表/新建/消息查看/发送(离线入队,恢复冲水)。
// 数据层 = lib/workApi + lib/workStore + lib/syncQueue(与网页 /workbench 同契约)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import { getCnSession } from '../lib/cnApi'
import { createWorkApi, type WorkClient } from '../lib/workApi'
import { createWorkStore, rememberSpace, type WorkStore, type WorkThread, type WorkMessage } from '../lib/workStore'
import { createWorkSync } from '../lib/syncQueue'

const C = { card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b', teal: '#1aeba8', red: '#e05656', input: '#0d1512' }

export function WorkThreadsCard() {
  const [ready, setReady] = useState(false)
  const [threads, setThreads] = useState<WorkThread[]>([])
  const [openThread, setOpenThread] = useState<WorkThread | null>(null)
  const [messages, setMessages] = useState<WorkMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // refs:跨渲染保持 api/store/sync(依手机号会话构建;无会话=未登录态)
  const ctxRef = useRef<{ api: WorkClient; store: WorkStore; phone: string; sync: ReturnType<typeof createWorkSync> } | null>(null)

  const ensureCtx = useCallback(async () => {
    if (ctxRef.current) return ctxRef.current
    const s = await getCnSession()
    if (!s) return null
    const api = createWorkApi({ getToken: () => s.token })
    const store = createWorkStore(s.phone, 'personal', null)
    await rememberSpace(s.phone, store.scopeKey)
    const sync = createWorkSync({ api, store, scope: 'personal' })
    ctxRef.current = { api, store, phone: s.phone, sync }
    return ctxRef.current
  }, [])

  const refresh = useCallback(async () => {
    const ctx = await ensureCtx()
    if (!ctx) { setNotice('未登录'); return }
    setBusy(true)
    try {
      await ctx.sync.rebuild()          // 快照重建(小数据量;增量追赶后续接 pull)
      setThreads(await ctx.store.listThreads())
      setNotice('')
    } catch (e) { setNotice(String((e as Error).message).slice(0, 60)) }
    finally { setBusy(false); setReady(true) }
  }, [ensureCtx])

  useEffect(() => { void refresh() }, [refresh])

  const open = useCallback(async (th: WorkThread) => {
    const ctx = ctxRef.current
    if (!ctx) return
    setOpenThread(th)
    const cached = await ctx.store.getMessages(th.threadId)
    if (cached) setMessages(cached)
    const r = await ctx.api.messageList({ threadId: th.threadId, afterSeq: 0, limit: 200 })
    if (!r.__notOk && Array.isArray(r.items)) {
      setMessages(r.items as WorkMessage[])
      await ctx.store.setMessages(th.threadId, r.items as WorkMessage[])
    }
  }, [])

  const createThread = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    setBusy(true)
    try {
      const r = await ctx.api.threadCreate({ scope: 'personal', title: '手机端会话 ' + new Date().toLocaleDateString() })
      if (r.__notOk) { setNotice('创建失败:' + (r.error || r.code)); return }
      const th = { threadId: (r.thread as { threadId: string }).threadId, scope: 'personal' as const, tenantId: null, title: String((r.thread as { title?: string }).title || ''), revision: Number((r.thread as { revision?: number }).revision || 1) }
      await ctx.store.upsertThread(th)
      setThreads(await ctx.store.listThreads())
      setOpenThread(th); setMessages([])
    } finally { setBusy(false) }
  }, [])

  const send = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx || !openThread || !draft.trim()) return
    setBusy(true)
    try {
      const r = await ctx.sync.send(openThread.threadId, [{ t: 'text', v: draft.trim() }], openThread.revision)
      setDraft('')
      if (r.conflict) { setNotice('版本冲突,重读中'); await open(openThread); return }
      if (r.queued) { setNotice('已入待发队列(网络恢复自动发)'); return }
      if (r.dropped) { setNotice('发送失败:' + (r.error || '')); return }
      // 刷新消息与 revision(reply 桥可能已追加助手消息)
      const th2 = await ctx.store.getThread(openThread.threadId)
      const cur = th2 || openThread
      if (typeof r.revision === 'number') cur.revision = r.revision
      await ctx.store.upsertThread(cur)
      setOpenThread(cur)
      const ml = await ctx.api.messageList({ threadId: cur.threadId, afterSeq: 0, limit: 200 })
      if (!ml.__notOk && Array.isArray(ml.items)) { setMessages(ml.items as WorkMessage[]); await ctx.store.setMessages(cur.threadId, ml.items as WorkMessage[]) }
      setNotice('')
    } finally { setBusy(false) }
  }, [draft, openThread, open])

  if (!ready) return <ActivityIndicator color={C.teal} />

  if (openThread) {
    return (
      <View style={s.wrap}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setOpenThread(null)}><Text style={s.back}>‹ 返回</Text></TouchableOpacity>
          <Text style={s.title} numberOfLines={1}>{openThread.title || '(未命名)'}</Text>
        </View>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.messageId}
          style={s.msgs}
          renderItem={({ item }) => (
            <View style={[s.msg, item.role === 'user' ? s.msgUser : s.msgBot]}>
              <Text style={s.msgRole}>{item.role === 'user' ? '' : '【' + (item.role === 'assistant' ? '助手' : '系统') + '】'}</Text>
              <Text style={s.msgText}>{item.parts?.[0]?.v || ''}</Text>
            </View>
          )}
        />
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        <View style={s.composer}>
          <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="输入消息…" placeholderTextColor={C.muted} multiline />
          <TouchableOpacity style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={send}>
            <Text style={s.btnText}>{busy ? '…' : '发送'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>工作记录(个人)</Text>
        <TouchableOpacity style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={createThread}>
          <Text style={s.btnText}>+ 新会话</Text>
        </TouchableOpacity>
      </View>
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      <FlatList
        data={threads}
        keyExtractor={(t) => t.threadId}
        style={s.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => open(item)}>
            <Text style={s.rowTitle} numberOfLines={1}>{item.title || '(未命名)'}</Text>
            <Text style={s.rowMeta}>r{item.revision}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>(空——点「+ 新会话」开始,消息级历史、跨设备同步)</Text>}
      />
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 10, maxHeight: 420 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { color: C.text, fontWeight: 'bold', fontSize: 14, flex: 1 },
  back: { color: C.teal, fontSize: 14, marginRight: 8 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  rowTitle: { color: C.text, flex: 1, fontSize: 13 },
  rowMeta: { color: C.muted, fontSize: 11, marginLeft: 8 },
  empty: { color: C.muted, fontSize: 12, paddingVertical: 12, textAlign: 'center' },
  msgs: { maxHeight: 240, marginBottom: 6 },
  msg: { borderRadius: 8, padding: 8, marginVertical: 3, maxWidth: '85%' },
  msgUser: { backgroundColor: '#1a2e26', alignSelf: 'flex-end' },
  msgBot: { backgroundColor: '#151d1a', alignSelf: 'flex-start' },
  msgRole: { color: C.muted, fontSize: 10 },
  msgText: { color: C.text, fontSize: 13 },
  notice: { color: C.muted, fontSize: 11, marginBottom: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  input: { flex: 1, backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 10, paddingVertical: 6, minHeight: 38, maxHeight: 90 },
  btn: { backgroundColor: C.teal, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  btnOff: { opacity: 0.5 },
  btnText: { color: '#06322a', fontWeight: 'bold', fontSize: 13 },
})
