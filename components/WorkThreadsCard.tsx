// 国际版手机端 · 工作记录卡(INT10 UI 接入,2026-10-25)
// 与大陆版 WorkThreadsCard 同构的自包含组件:work 协议会话——
// 个人空间线程列表/新建/消息查看/发送(离线入队,恢复冲水);发送后服务端回复桥
// 的 AI 回复随响应返回,刷新即显示。
// 差异:鉴权=Supabase 会话(getSession 每次取新令牌,自动续期由 supabase 客户端管);
//      本地缓存键=userId(国际版账号主键)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import { getSession } from '../lib/supabase'
import { createWorkApi, type WorkClient } from '../lib/workApi'
import { createWorkStore, rememberSpace, type WorkStore, type WorkThread, type WorkMessage } from '../lib/workStore'
import { createWorkSync } from '../lib/syncQueue'

// 配色与 App 既有暗色蓝紫基调一致(index.tsx 的 C 系)
const C = { card: '#171a2e', border: '#252845', text: '#e8eaf6', muted: '#80849e', teal: '#2dd4a7', input: '#12142a' }

export function WorkThreadsCard() {
  const [ready, setReady] = useState(false)
  const [threads, setThreads] = useState<WorkThread[]>([])
  const [openThread, setOpenThread] = useState<WorkThread | null>(null)
  const [messages, setMessages] = useState<WorkMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // refs:跨渲染保持 api/store/sync(依登录会话构建;未登录=提示态)
  const ctxRef = useRef<{ api: WorkClient; store: WorkStore; userId: string; sync: ReturnType<typeof createWorkSync> } | null>(null)

  const ensureCtx = useCallback(async () => {
    if (ctxRef.current) return ctxRef.current
    const s = await getSession()
    if (!s || !s.user) return null
    const api = createWorkApi({
      // 每次调用取当前令牌(supabase 客户端自动续期;1 小时过期不再卡死卡片)
      getToken: async () => (await getSession())?.access_token ?? '',
    })
    const store = createWorkStore(s.user.id, 'personal', null)
    await rememberSpace(s.user.id, store.scopeKey)
    const sync = createWorkSync({ api, store, scope: 'personal' })
    ctxRef.current = { api, store, userId: s.user.id, sync }
    return ctxRef.current
  }, [])

  const refresh = useCallback(async () => {
    const ctx = await ensureCtx()
    if (!ctx) { setNotice('Not signed in'); setReady(true); return }
    setBusy(true)
    try {
      let items = await ctx.store.listThreads()
      try {
        await ctx.sync.rebuild()          // 快照重建(小数据量;增量追赶后续接 poll)
        items = await ctx.store.listThreads()
      } catch { /* 离线/切换域名失败:先用本地缓存渲染 */ }
      setThreads(items)
      setNotice('')
    } finally { setBusy(false); setReady(true) }
  }, [ensureCtx])

  useEffect(() => { void refresh() }, [refresh])

  const open = useCallback(async (th: WorkThread) => {
    const ctx = ctxRef.current
    if (!ctx) return
    setOpenThread(th)
    const cached = await ctx.store.getMessages(th.threadId)
    if (cached) setMessages(cached)
    const r = await ctx.sync.loadMessages(th.threadId)
    if (!r.__notOk && Array.isArray(r.items)) setMessages(r.items as WorkMessage[])
  }, [])

  const createThread = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    setBusy(true)
    try {
      const r = await ctx.api.threadCreate({ scope: 'personal', title: 'Mobile · ' + new Date().toLocaleDateString() })
      if (r.__notOk) { setNotice('Create failed: ' + (r.error || r.code)); return }
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
      // S01:conflict 时回填消息文本——旧版清空草稿后直接丢弃,用户输入白打
      if (r.conflict) {
        const back = r.parts && r.parts[0] && r.parts[0].v
        if (back) setDraft(String(back))
        setNotice('Version conflict — reloaded, message restored, resend to retry')
        await open(openThread)
        return
      }
      if (r.queued) { setNotice('Queued — will send when back online'); return }
      if (r.dropped) { setNotice('Send failed: ' + (r.error || '')); return }
      // 推进本地 revision(响应真值;回复桥可能已 +1)并拉新消息(含 AI 回复)
      const th2 = await ctx.store.getThread(openThread.threadId)
      const cur = th2 || openThread
      if (typeof r.revision === 'number') cur.revision = r.revision
      await ctx.store.upsertThread(cur)
      setOpenThread(cur)
      const ml = await ctx.sync.loadMessages(cur.threadId)
      if (!ml.__notOk && Array.isArray(ml.items)) setMessages(ml.items as WorkMessage[])
      setNotice('')
    } finally { setBusy(false) }
  }, [draft, openThread, open])

  if (!ready) return <ActivityIndicator color={C.teal} />

  if (openThread) {
    return (
      <View style={s.wrap}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setOpenThread(null)}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
          <Text style={s.title} numberOfLines={1}>{openThread.title || '(untitled)'}</Text>
        </View>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.messageId}
          style={s.msgs}
          renderItem={({ item }) => (
            <View style={[s.msg, item.role === 'user' ? s.msgUser : s.msgBot]}>
              {item.role !== 'user' ? <Text style={s.msgRole}>{item.role === 'assistant' ? 'Bayze' : item.role}</Text> : null}
              <Text style={s.msgText}>{item.parts?.[0]?.v || ''}</Text>
            </View>
          )}
        />
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        <View style={s.composer}>
          <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Message…" placeholderTextColor={C.muted} multiline />
          <TouchableOpacity style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={send}>
            <Text style={s.btnText}>{busy ? '…' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>Work Records · Personal</Text>
        <TouchableOpacity style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={createThread}>
          <Text style={s.btnText}>+ New</Text>
        </TouchableOpacity>
      </View>
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      <FlatList
        data={threads}
        keyExtractor={(t) => t.threadId}
        style={s.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => open(item)}>
            <Text style={s.rowTitle} numberOfLines={1}>{item.title || '(untitled)'}</Text>
            <Text style={s.rowMeta}>r{item.revision}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>(empty — tap “+ New” to start; message-level history, syncs across devices)</Text>}
      />
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { color: C.text, fontWeight: 'bold', fontSize: 14, flex: 1 },
  back: { color: C.teal, fontSize: 14, marginRight: 8 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  rowTitle: { color: C.text, flex: 1, fontSize: 13 },
  rowMeta: { color: C.muted, fontSize: 11, marginLeft: 8 },
  empty: { color: C.muted, fontSize: 12, paddingVertical: 12, textAlign: 'center' },
  msgs: { flex: 1, marginBottom: 6 },
  msg: { borderRadius: 8, padding: 8, marginVertical: 3, maxWidth: '85%' },
  msgUser: { backgroundColor: '#233052', alignSelf: 'flex-end' },
  msgBot: { backgroundColor: '#1b1e38', alignSelf: 'flex-start' },
  msgRole: { color: C.muted, fontSize: 10 },
  msgText: { color: C.text, fontSize: 13 },
  notice: { color: C.muted, fontSize: 11, marginBottom: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  input: { flex: 1, backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 10, paddingVertical: 6, minHeight: 38, maxHeight: 90 },
  btn: { backgroundColor: C.teal, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  btnOff: { opacity: 0.5 },
  btnText: { color: '#0a2e24', fontWeight: 'bold', fontSize: 13 },
})
