// 国际版手机端 · 工作记录卡(INT10 UI + Phase 1/2 优化,2026-10-30)
// 与大陆版 WorkThreadsCard 同构的自包含组件:work 协议会话——
// 个人空间线程列表/新建/消息查看/发送(离线入队,恢复冲水);发送后服务端回复桥
// 的 AI 回复随响应返回,刷新即显示。
// Phase 1: 空态居中引导 + 场景快捷按钮条 + 推荐提示词。
// Phase 2: 指令库 Modal 抽屉(卡片式,点击填入;对标 WorkBuddy 指令市场)。
// 差异:鉴权=Supabase 会话(getSession 每次取新令牌,自动续期由 supabase 客户端管);
//      本地缓存键=userId(国际版账号主键)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, ScrollView, Modal } from 'react-native'
import { getSession } from '../lib/supabase'
import { createWorkApi, type WorkClient } from '../lib/workApi'
import { createWorkStore, rememberSpace, type WorkStore, type WorkThread, type WorkMessage } from '../lib/workStore'
import { createWorkSync } from '../lib/syncQueue'

// 配色与 App 既有暗色蓝紫基调一致(index.tsx 的 C 系)
const C = { card: '#171a2e', border: '#252845', text: '#e8eaf6', muted: '#80849e', teal: '#2dd4a7', input: '#12142a' }

// Phase 1: 场景快捷按钮(内置;企业模板后续接入)
const SCENARIOS = [
  { icon: '📊', title: 'Summary', prompt: 'Help me generate a summary of business data' },
  { icon: '📝', title: 'Weekly', prompt: 'Help me write a weekly work report' },
  { icon: '🔍', title: 'Search', prompt: 'Help me find relevant knowledge' },
  { icon: '👥', title: 'Customer', prompt: 'Help me look up customer information' },
]

// Phase 1: 推荐提示词(空态显示)
const PROMPTS = [
  { icon: '📊', text: 'Summarize this week\'s key metrics' },
  { icon: '👥', text: 'Show my top customers status' },
  { icon: '📝', text: 'Draft a project status update' },
]

export function WorkThreadsCard() {
  const [ready, setReady] = useState(false)
  const [threads, setThreads] = useState<WorkThread[]>([])
  const [openThread, setOpenThread] = useState<WorkThread | null>(null)
  const [messages, setMessages] = useState<WorkMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // Phase 2: 指令库抽屉
  const [libOpen, setLibOpen] = useState(false)
  // Phase 3: @ 引用选择器
  const [atOpen, setAtOpen] = useState(false)
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
        {messages.length === 0 ? (
          /* Phase 1: 空态居中引导 */
          <View style={s.hero}>
            <Text style={s.heroTitle}>What can I help you with?</Text>
            <Text style={s.heroSub}>Type below or tap a suggestion</Text>
            {PROMPTS.map((p, i) => (
              <TouchableOpacity key={i} style={s.promptCard} onPress={() => setDraft(p.text)}>
                <Text style={s.promptIcon}>{p.icon}</Text>
                <Text style={s.promptText}>{p.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
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
        )}
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {/* Phase 1: 场景快捷条 + Phase 2 指令库入口 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scenarioStrip}>
          {SCENARIOS.map((sc, i) => (
            <TouchableOpacity key={i} style={s.scenarioBtn} onPress={() => setDraft(sc.prompt)}>
              <Text style={s.scenarioIcon}>{sc.icon}</Text>
              <Text style={s.scenarioLabel}>{sc.title}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[s.scenarioBtn, s.libBtn]} onPress={() => setLibOpen(true)}>
            <Text style={s.scenarioIcon}>🎯</Text>
            <Text style={[s.scenarioLabel, { color: C.teal }]}>Library</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.scenarioBtn, s.libBtn]} onPress={() => setAtOpen(true)}>
            <Text style={s.scenarioIcon}>@</Text>
            <Text style={[s.scenarioLabel, { color: C.teal }]}>Reference</Text>
          </TouchableOpacity>
        </ScrollView>
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

      {/* Phase 2: 指令库抽屉(Modal 半屏) */}
      <Modal visible={libOpen} animationType="slide" transparent onRequestClose={() => setLibOpen(false)}>
        <View style={s.libOverlay}>
          <View style={s.libSheet}>
            <View style={s.libHeader}>
              <Text style={s.libTitle}>🎯 Command Library</Text>
              <TouchableOpacity onPress={() => setLibOpen(false)}>
                <Text style={s.libClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.libList}>
              {SCENARIOS.map((sc, i) => (
                <TouchableOpacity key={i} style={s.libCard} onPress={() => { setDraft(sc.prompt); setLibOpen(false) }}>
                  <Text style={s.libCardIcon}>{sc.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.libCardTitle}>{sc.title}</Text>
                    <Text style={s.libCardDesc} numberOfLines={1}>{sc.prompt}</Text>
                  </View>
                  <Text style={s.libCardAct}>Fill →</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Phase 3: @ 引用选择器(Modal) */}
      <Modal visible={atOpen} animationType="slide" transparent onRequestClose={() => setAtOpen(false)}>
        <View style={s.libOverlay}>
          <View style={s.libSheet}>
            <View style={s.libHeader}>
              <Text style={s.libTitle}>@ Reference knowledge & documents</Text>
              <TouchableOpacity onPress={() => setAtOpen(false)}>
                <Text style={s.libClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.libList}>
              {PROMPTS.map((p, i) => (
                <TouchableOpacity key={'p' + i} style={s.libCard} onPress={() => { setDraft(draft + ` @[${p.icon} ${p.text.slice(0, 20)}] `); setAtOpen(false) }}>
                  <Text style={s.libCardIcon}>{p.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.libCardTitle}>{p.text}</Text>
                    <Text style={s.libCardDesc}>Tap to reference in message</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  // Phase 1: 空态引导
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  heroTitle: { color: C.text, fontSize: 20, fontWeight: '600' },
  heroSub: { color: C.muted, fontSize: 13 },
  promptCard: { flexDirection: 'row', alignItems: 'center', width: '100%', borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.teal, borderRadius: 8, padding: 10, backgroundColor: C.input },
  promptIcon: { fontSize: 16, marginRight: 8 },
  promptText: { color: C.text, fontSize: 13, flex: 1 },
  // Phase 1: 场景快捷条
  scenarioStrip: { flexDirection: 'row', maxHeight: 40, marginBottom: 6 },
  scenarioBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 5, marginRight: 6, backgroundColor: C.input },
  scenarioIcon: { fontSize: 14, marginRight: 4 },
  scenarioLabel: { color: C.text, fontSize: 12 },
  libBtn: { borderColor: C.teal },
  // Phase 2: 指令库抽屉
  libOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  libSheet: { backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%', paddingBottom: 20 },
  libHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  libTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  libClose: { color: C.muted, fontSize: 16, paddingHorizontal: 8 },
  libList: { padding: 8 },
  libCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: C.input },
  libCardIcon: { fontSize: 18, marginRight: 10 },
  libCardTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  libCardDesc: { color: C.muted, fontSize: 11, marginTop: 2 },
  libCardAct: { color: C.teal, fontSize: 12 },
})
