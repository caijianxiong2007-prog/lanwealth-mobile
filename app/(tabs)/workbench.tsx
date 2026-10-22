// 大陆版工作台(P2-01 一期,2026-10-19):移动场景五件套——待办审批/费用提交/
// 我的单据/订单查询(PO·SO)/知识检索。全部复用网页版既有 cn-api 动作,权限由
// 服务端逐动作校验(无权项显示"无权限"态);无企业上下文时引导网页版开通。
import { useCallback, useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  cnWorkSetup, cnTodoList, cnTodoDone, cnExpenseDecide, cnExpenseCreate, cnExpenseMine,
  cnOrders, cnKbSearch, type CnTodo, type CnExpense, type CnOrder,
} from '../../lib/cnApi'
import { WorkThreadsCard } from '../../components/WorkThreadsCard'

const C = { bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b', teal: '#1aeba8', red: '#e05656' }

const CATS = [
  ['office', '办公'], ['travel', '差旅'], ['marketing', '市场'], ['meeting', '会务'],
  ['maintenance', '维保'], ['service', '服务'], ['rd', '研发'], ['other', '其他'],
] as const
const EXP_ST: Record<string, string> = { draft: '草稿', submitted: '审批中', approved: '已批', rejected: '已驳回', partial_paid: '部分付款', paid: '已付', cancelled: '已取消' }
const ORD_ST: Record<string, string> = { draft: '草稿', submitted: '待批', approved: '已批', rejected: '已驳回', receiving: '收货中', completed: '已完成', cancelled: '已取消' }

type SetupState = { state: 'loading' } | { state: 'ok'; tenant_id: number } | { state: 'none' } | { state: 'error'; error: string }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{children}</View>
}

export default function WorkbenchScreen() {
  const insets = useSafeAreaInsets()
  const [setup, setSetup] = useState<SetupState>({ state: 'loading' })
  const [todos, setTodos] = useState<CnTodo[]>([])
  const [expenses, setExpenses] = useState<CnExpense[]>([])
  const [orders, setOrders] = useState<CnOrder[]>([])
  const [orderKind, setOrderKind] = useState<'po' | 'so'>('po')
  const [refreshing, setRefreshing] = useState(false)
  // 费用表单
  const [fxCat, setFxCat] = useState<string>('office')
  const [fxAmount, setFxAmount] = useState('')
  const [fxVendor, setFxVendor] = useState('')
  const [fxDesc, setFxDesc] = useState('')
  const [fxBusy, setFxBusy] = useState(false)
  // 知识检索
  const [kbQ, setKbQ] = useState('')
  const [kbHits, setKbHits] = useState<{ title: string; snippet: string }[] | null>(null)
  const [kbBusy, setKbBusy] = useState(false)

  const loadAll = useCallback(async () => {
    setSetup(s => s.state === 'ok' || s.state === 'none' ? s : { state: 'loading' })
    try {
      const su = await cnWorkSetup()
      setSetup({ state: 'ok', tenant_id: su.tenant_id })
      const [t, e, o] = await Promise.allSettled([cnTodoList(), cnExpenseMine(), cnOrders('po')])
      if (t.status === 'fulfilled') setTodos(t.value)
      if (e.status === 'fulfilled') setExpenses(e.value)
      if (o.status === 'fulfilled') setOrders(o.value)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加载失败'
      setSetup(/企业|开通|上下文/.test(msg) ? { state: 'none' } : { state: 'error', error: msg })
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadAll()
    if (setup.state === 'ok') setOrders(await cnOrders(orderKind).catch(() => []))
    setRefreshing(false)
  }

  async function decideExpense(todo: CnTodo, decision: 'approved' | 'rejected') {
    const verb = decision === 'approved' ? '批准' : '驳回'
    Alert.alert(verb + '费用申请', todo.title + (todo.detail?.amount ? '\n金额 ¥' + todo.detail.amount : '') + '\n\n确认' + verb + '?', [
      { text: '取消', style: 'cancel' },
      { text: verb, style: decision === 'approved' ? 'default' : 'destructive', onPress: async () => {
        const r = await cnExpenseDecide(todo.source_id, decision)
        if (r.ok) { loadAll() } else Alert.alert('操作失败', r.error || '请稍后再试')
      } },
    ])
  }

  async function submitExpense() {
    const amt = fxAmount.trim()
    if (!/^\d+(\.\d{1,2})?$/.test(amt) || Number(amt) <= 0) { Alert.alert('金额须为正数,最多两位小数'); return }
    if (!fxDesc.trim() || fxDesc.trim().length < 2) { Alert.alert('请填写费用事由(至少 2 字)'); return }
    setFxBusy(true)
    const r = await cnExpenseCreate(fxCat, amt, fxVendor.trim(), fxDesc.trim())
    setFxBusy(false)
    if (r.ok) {
      Alert.alert('已提交', '单号 ' + (r.doc_no || '-') + (r.error ? '\n' + r.error : '') + '\n可在我的一栏查看进度')
      setFxAmount(''); setFxVendor(''); setFxDesc('')
      loadAll()
    } else Alert.alert('提交失败', r.error || '请稍后再试')
  }

  async function switchOrders(kind: 'po' | 'so') {
    setOrderKind(kind)
    setOrders([])
    setOrders(await cnOrders(kind).catch(() => []))
  }

  async function doKbSearch() {
    const q = kbQ.trim()
    if (q.length < 2) { Alert.alert('请至少输入两个字'); return }
    setKbBusy(true); setKbHits(null)
    const tid = setup.state === 'ok' ? setup.tenant_id : undefined
    setKbHits(await cnKbSearch(q, tid).catch(() => []))
    setKbBusy(false)
  }

  return (
    <ScrollView style={[s.wrap, { paddingTop: insets.top }]} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.teal} />}>
      <Text style={s.title}>工作台</Text>

      {/* 企业上下文 */}
      {setup.state === 'loading' && <View style={s.center}><ActivityIndicator color={C.teal} /><Text style={s.muted}>加载企业上下文…</Text></View>}
      {setup.state === 'none' && (
        <Card title="🏢 企业工作台">
          <Text style={s.muted}>当前账号未开通企业空间。企业审批、费用、订单与共享知识库需先在网页版(app.lanwealth.cn → 企业团队)创建或加入企业。</Text>
        </Card>
      )}
      {setup.state === 'error' && (
        <Card title="🏢 企业工作台">
          <Text style={{ color: C.red, fontSize: 13 }}>加载失败:{setup.error}</Text>
          <TouchableOpacity style={s.btnGhost} onPress={loadAll}><Text style={s.btnGhostTx}>重试</Text></TouchableOpacity>
        </Card>
      )}

      {setup.state === 'ok' && (<>
        {/* 待办与审批 */}
        <Card title={'🔔 待办与审批' + (todos.length ? `(${todos.length})` : '')}>
          {todos.length === 0 ? <Text style={s.muted}>暂无待办 🎉</Text> : todos.map(x => (
            <View key={x.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowMain}>{x.title}{x.detail?.amount ? <Text style={{ color: C.teal }}> ¥{x.detail.amount}</Text> : null}</Text>
              </View>
              {x.source_type === 'approval.expense' ? (
                <>
                  <TouchableOpacity style={s.btnMini} onPress={() => decideExpense(x, 'approved')}><Text style={s.btnMiniTx}>批准</Text></TouchableOpacity>
                  <TouchableOpacity style={s.btnMiniD} onPress={() => decideExpense(x, 'rejected')}><Text style={s.btnMiniDx}>驳回</Text></TouchableOpacity>
                </>
              ) : <Text style={s.mutedSm}>去网页版处理</Text>}
              <TouchableOpacity onPress={async () => { await cnTodoDone(x.id).catch(() => {}); loadAll() }}><Text style={s.linkMuted}>忽略</Text></TouchableOpacity>
            </View>
          ))}
        </Card>

        {/* 费用提交 */}
        <Card title="💰 费用报销">
          <View style={s.chips}>
            {CATS.map(([k, label]) => (
              <TouchableOpacity key={k} style={[s.chip, fxCat === k && s.chipOn]} onPress={() => setFxCat(k)}>
                <Text style={[s.chipTx, fxCat === k && s.chipOnTx]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={s.input} placeholder="金额(元,如 320.00)" placeholderTextColor={C.muted} keyboardType="decimal-pad"
            value={fxAmount} onChangeText={t => setFxAmount(t.replace(/[^\d.]/g, ''))} />
          <TextInput style={s.input} placeholder="供应商(选填)" placeholderTextColor={C.muted} value={fxVendor} onChangeText={setFxVendor} />
          <TextInput style={s.input} placeholder="费用事由(如:华东客户拜访交通费)" placeholderTextColor={C.muted} value={fxDesc} onChangeText={setFxDesc} />
          <TouchableOpacity style={s.btn} onPress={submitExpense} disabled={fxBusy} activeOpacity={0.8}>
            {fxBusy ? <ActivityIndicator color="#04140e" /> : <Text style={s.btnTx}>提交报销(自动送审)</Text>}
          </TouchableOpacity>
        </Card>

        {/* 我的单据 */}
        <Card title={'🧾 我的单据' + (expenses.length ? `(${expenses.length})` : '')}>
          {expenses.length === 0 ? <Text style={s.muted}>暂无费用单据</Text> : expenses.slice(0, 10).map(x => (
            <View key={x.id} style={s.row}>
              <Text style={s.rowMain} numberOfLines={1}>{x.doc_no} ¥{x.amount}</Text>
              <Text style={[s.st, x.status === 'rejected' && { color: C.red }, x.status === 'approved' && { color: C.teal }]}>{EXP_ST[x.status] || x.status}</Text>
            </View>
          ))}
        </Card>

        {/* 订单查询 */}
        <Card title="📦 订单查询">
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <TouchableOpacity style={[s.seg, orderKind === 'po' && s.segOn]} onPress={() => switchOrders('po')}><Text style={[s.segTx, orderKind === 'po' && s.segOnTx]}>采购 PO</Text></TouchableOpacity>
            <TouchableOpacity style={[s.seg, orderKind === 'so' && s.segOn]} onPress={() => switchOrders('so')}><Text style={[s.segTx, orderKind === 'so' && s.segOnTx]}>销售 SO</Text></TouchableOpacity>
          </View>
          {orders.length === 0 ? <Text style={s.muted}>暂无{orderKind === 'po' ? '采购' : '销售'}订单(或无查看权限)</Text> : orders.slice(0, 10).map(x => (
            <View key={x.id} style={s.row}>
              <Text style={s.rowMain} numberOfLines={1}>{x.po_no || x.so_no} · {(x.supplier || x.customer || '') + ' '}¥{x.amount}</Text>
              <Text style={s.st}>{ORD_ST[x.status] || x.status}</Text>
            </View>
          ))}
        </Card>

        {/* 知识检索 */}
        <Card title="🔍 知识检索(企业共享)">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="检索企业知识库(至少两个字)" placeholderTextColor={C.muted}
              value={kbQ} onChangeText={setKbQ} onSubmitEditing={doKbSearch} returnKeyType="search" />
            <TouchableOpacity style={s.btnMini} onPress={doKbSearch} disabled={kbBusy}><Text style={s.btnMiniTx}>{kbBusy ? '…' : '搜索'}</Text></TouchableOpacity>
          </View>
          {kbHits === null ? null : kbHits.length === 0 ? <Text style={[s.muted, { marginTop: 8 }]}>无匹配结果</Text> : kbHits.map((h, i) => (
            <View key={i} style={{ marginTop: 10 }}>
              <Text style={{ color: C.text, fontSize: 13.5, fontWeight: '600' }}>{h.title}</Text>
              <Text style={s.mutedSm} numberOfLines={2}>{h.snippet}…</Text>
            </View>
          ))}
        </Card>

        {/* 工作记录(CN10:新版 work 协议;个人空间,消息级历史+离线队列) */}
        <Card title="💬 工作记录(新版)">
          <WorkThreadsCard />
        </Card>
      </>)}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  title: { color: C.text, fontSize: 22, fontWeight: '700', marginBottom: 14 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 12 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  center: { alignItems: 'center', padding: 30, gap: 8 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  mutedSm: { color: C.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border },
  rowMain: { color: C.text, fontSize: 13, flex: 1 },
  st: { color: C.muted, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.border },
  chipOn: { borderColor: C.teal, backgroundColor: 'rgba(26,235,168,.12)' },
  chipTx: { color: C.muted, fontSize: 12.5 },
  chipOnTx: { color: C.teal },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, fontSize: 14, padding: 11, marginBottom: 9 },
  btn: { backgroundColor: C.teal, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4 },
  btnTx: { color: '#04140e', fontSize: 14.5, fontWeight: '700' },
  btnGhost: { borderWidth: 1, borderColor: C.teal, borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 10 },
  btnGhostTx: { color: C.teal, fontSize: 13.5 },
  btnMini: { backgroundColor: C.teal, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12 },
  btnMiniTx: { color: '#04140e', fontSize: 12.5, fontWeight: '700' },
  btnMiniD: { borderWidth: 1, borderColor: C.red, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12 },
  btnMiniDx: { color: C.red, fontSize: 12.5 },
  linkMuted: { color: C.muted, fontSize: 12 },
  seg: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 7, alignItems: 'center' },
  segOn: { borderColor: C.teal, backgroundColor: 'rgba(26,235,168,.12)' },
  segTx: { color: C.muted, fontSize: 13 },
  segOnTx: { color: C.teal, fontWeight: '700' },
})
