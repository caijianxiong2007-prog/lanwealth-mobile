// 大陆版手机端 · 工作记录卡(CN10 UI + Phase 1/2 优化,2026-10-30)
// 嵌入工作台(workbench.tsx)的自包含组件:新版 work 协议会话——
// 个人空间线程列表/新建/消息查看/发送(离线入队,恢复冲水)。
// Phase 1: 空态居中引导 + 场景快捷按钮条。Phase 2: 指令库 Modal 抽屉。
// 数据层 = lib/workApi + lib/workStore + lib/syncQueue(与网页 /workbench 同契约)。
import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, ScrollView, Modal } from 'react-native'
import { getCnSession } from '../lib/cnApi'
import { createWorkApi, type WorkClient } from '../lib/workApi'
import { createWorkStore, rememberSpace, type WorkStore, type WorkThread, type WorkMessage } from '../lib/workStore'
import { createWorkSync } from '../lib/syncQueue'

const C = { card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b', teal: '#1aeba8', red: '#e05656', input: '#0d1512' }

// Phase 1(UI优化 2026-10-30): 场景快捷按钮
const SCENARIOS = [
  { icon: '📊', title: '摘要', prompt: '帮我生成一份经营数据摘要' },
  { icon: '📝', title: '周报', prompt: '帮我生成本周工作周报' },
  { icon: '🔍', title: '检索', prompt: '帮我查找相关知识和资料' },
  { icon: '👥', title: '客户', prompt: '帮我查询客户信息和跟进记录' },
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
    const r = await ctx.api.messageList({ threadId: th.threadId, beforeSeq: 9007199254740991, limit: 200  // S03:取最新尾页,旧版 afterSeq:0 只见最早 200 条 })
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
      // S01:conflict 时回填消息文本——旧版清空草稿后直接丢弃,用户输入白打
      if (r.conflict) {
        const back = r.parts && r.parts[0] && r.parts[0].v
        if (back) setDraft(String(back))
        setNotice('版本冲突:已重读,消息已回填可重发')
        await open(openThread)
        return
      }
      if (r.queued) { setNotice('已入待发队列(网络恢复自动发)'); return }
      if (r.dropped) { setNotice('发送失败:' + (r.error || '')); return }
      // 刷新消息与 revision(reply 桥可能已追加助手消息)
      const th2 = await ctx.store.getThread(openThread.threadId)
      const cur = th2 || openThread
      if (typeof r.revision === 'number') cur.revision = r.revision
      await ctx.store.upsertThread(cur)
      setOpenThread(cur)
      const ml = await ctx.api.messageList({ threadId: cur.threadId, beforeSeq: 9007199254740991, limit: 200  // S03:取最新尾页,旧版 afterSeq:0 只见最早 200 条 })
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
        {messages.length === 0 ? (
          /* Phase 1: 空态居中引导 */
          <View style={s.hero}>
            <Text style={s.heroTitle}>今天帮你做些什么？</Text>
            <Text style={s.heroSub}>在下方输入或点击提示词开始</Text>
            {SCENARIOS.map((sc, i) => (
              <TouchableOpacity key={i} style={s.promptCard} onPress={() => setDraft(sc.prompt)}>
                <Text style={s.promptIcon}>{sc.icon}</Text>
                <Text style={s.promptText}>{sc.prompt}</Text>
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
                <Text style={s.msgRole}>{item.role === 'user' ? '' : '【' + (item.role === 'assistant' ? '助手' : '系统') + '】'}</Text>
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
            <Text style={[s.scenarioLabel, { color: C.teal }]}>指令库</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.scenarioBtn, s.libBtn]} onPress={() => setAtOpen(true)}>
            <Text style={s.scenarioIcon}>@</Text>
            <Text style={[s.scenarioLabel, { color: C.teal }]}>引用</Text>
          </TouchableOpacity>
        </ScrollView>
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

      {/* Phase 2: 指令库抽屉(Modal 半屏) */}
      <Modal visible={libOpen} animationType="slide" transparent onRequestClose={() => setLibOpen(false)}>
        <View style={s.libOverlay}>
          <View style={s.libSheet}>
            <View style={s.libHeader}>
              <Text style={s.libTitle}>🎯 指令库</Text>
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
                  <Text style={s.libCardAct}>填入 →</Text>
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
              <Text style={s.libTitle}>@ 引用知识与资料</Text>
              <TouchableOpacity onPress={() => setAtOpen(false)}>
                <Text style={s.libClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.libList}>
              {SCENARIOS.map((sc, i) => (
                <TouchableOpacity key={i} style={s.libCard} onPress={() => { setDraft(draft + ` @[${sc.icon} ${sc.title}] `); setAtOpen(false) }}>
                  <Text style={s.libCardIcon}>{sc.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.libCardTitle}>{sc.prompt}</Text>
                    <Text style={s.libCardDesc}>点击引用到消息</Text>
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
  // Phase 1: 空态引导
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 },
  heroTitle: { color: C.text, fontSize: 18, fontWeight: '600' },
  heroSub: { color: C.muted, fontSize: 12 },
  promptCard: { flexDirection: 'row', alignItems: 'center', width: '100%', borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.teal, borderRadius: 8, padding: 8, backgroundColor: C.input },
  promptIcon: { fontSize: 14, marginRight: 6 },
  promptText: { color: C.text, fontSize: 12, flex: 1 },
  // Phase 1: 场景快捷条
  scenarioStrip: { flexDirection: 'row', maxHeight: 36, marginBottom: 4 },
  scenarioBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, backgroundColor: C.input },
  scenarioIcon: { fontSize: 13, marginRight: 3 },
  scenarioLabel: { color: C.text, fontSize: 11 },
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
