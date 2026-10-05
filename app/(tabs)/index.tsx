// 大陆版聊天页(cn 分支,v0.2.1):
//   · Bayze 智选(瀑布式:专家模型→V4 Pro 终审)+ 5 个已备案国产模型;SSE 流式对话
//     (cn-stream /stream,失败自动降级非流式);回复气泡带模型徽章;空状态为白泽狮标
//   · 多会话本地管理(按手机号命名空间,仅存本机);服务端按活跃企业岗位自动注入人设、
//     额度闸门/保密对话企业开关同网页端
//   · 附件:选文档 → 服务端提取文本(PDF/DOCX/TXT,直传不入库)→ 作为本轮上下文注入
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Keyboard, Image, Pressable,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Svg, { Path } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { CN_MODELS, cnChat, cnStreamChat, cnStopStream, cnLogout, getCnSession, cnFileExtract, cnOcr, CN_USER_STOP, type CnMessage } from '../../lib/cnApi'
import { useShareIntentContext } from 'expo-share-intent'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import * as ImagePicker from 'expo-image-picker'
import {
  loadConversations, upsertConversation, dropConversation, wipeConversations,
  createConversationId, titleFrom, type CnConversation,
} from '../../lib/cnConversations'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', tealDim: 'rgba(26,235,168,.1)', red: '#e05656',
}

type Bubble = { role: 'user' | 'assistant'; content: string; ts: number; model?: string }

// 分享转入支持的文档类型(与 📎 附件同一集合;图片分享暂不接,提示走截图后网页 OCR)
const SHARE_DOC_EXTS = ['pdf', 'docx', 'doc', 'txt', 'md', 'csv']

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
  const [attachErr, setAttachErr] = useState<{ name: string; msg: string } | null>(null)
  const [imgAttach, setImgAttach] = useState<string | null>(null)   // 图片附件(原图 base64,走视觉模型看图)
  const [attachBusy, setAttachBusy] = useState(false)
  const [listening, setListening] = useState(false)   // 语音听写中
  const [ctxMsg, setCtxMsg] = useState<{ x: number; y: number; content: string; canRefresh: boolean } | null>(null)  // 长按弹窗
  const [plusOpen, setPlusOpen] = useState(false)     // 「+」附件菜单
  const [tip, setTip] = useState<string | null>(null) // 轻提示(复制成功等)
  const listRef  = useRef<FlatList<Bubble>>(null)
  const abortRef = useRef<AbortController | null>(null)   // 保留给非流式降级路径;流式停止走 cnStopStream
  const kbGap = useRef(0)       // 键盘高度(Android 手动避让)
  const voiceBase = useRef('')  // 本次听写开始前输入框已有内容(追加式转写)
  const cnActiveCleanup = () => { abortRef.current = null }

  // ── 系统分享/「用其他应用打开」转入(微信等第三方 App 分享文本或文档到这里)──
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext()
  const shareBusyRef = useRef(false)
  useEffect(() => {
    if (!hasShareIntent || shareBusyRef.current) return
    if (!shareIntent) return
    shareBusyRef.current = true
    ;(async () => {
      try {
        const sharedText = (shareIntent.text || shareIntent.webUrl || '').trim()
        const sharedFiles = shareIntent.files ?? []
        if (sharedText) setInput(p => (p.trim() ? p + '\n' + sharedText : sharedText))
        if (sharedFiles.length > 1) Alert.alert('一次转一个', '当前对话附件一次只挂一个文件,已取第一个。')
        for (const file of sharedFiles.slice(0, 1)) {
          const name = file.fileName || file.path.split('/').pop() || '分享文件'
          const ext = (name.split('.').pop() || '').toLowerCase()
          if (!SHARE_DOC_EXTS.includes(ext)) {
            Alert.alert('暂不支持该类型', `${name}:目前支持 PDF/Word/TXT/CSV/Markdown 转入对话`)
            continue
          }
          setAttachBusy(true)
          try {
            const b64 = await FileSystem.readAsStringAsync(file.path, { encoding: FileSystem.EncodingType.Base64 })
            const out = await cnFileExtract(name, b64)
            if (out.ok && out.text) setAttach({ name, chars: out.chars || out.text.length, text: out.text })
            else Alert.alert('附件提取失败', out.error || '请换用文本内容粘贴')
          } catch (e) {
            Alert.alert('附件读取失败', e instanceof Error ? e.message : '请重试')
          } finally {
            setAttachBusy(false)
          }
        }
      } finally {
        resetShareIntent()
        shareBusyRef.current = false
      }
    })()
  }, [hasShareIntent, shareIntent, resetShareIntent])

  // ── 语音听写(iOS 系统识别/Android 依机型语音服务;识别文字直接进输入框可编辑)──
  useSpeechRecognitionEvent('result', (ev) => {
    const t = (ev.results?.[0]?.transcript || '').trim()
    if (!t) return
    setInput(voiceBase.current + t)
  })
  useSpeechRecognitionEvent('error', (ev) => {
    setListening(false)
    const code = String(ev.error || '')
    if (code === 'not-permitted' || code === 'service-not-permitted') {
      Alert.alert('需要麦克风权限', '请在系统设置中允许白泽使用麦克风与语音识别。')
    } else if (listening || code !== 'aborted') {
      // 部分国产 Android 无谷歌语音服务会走到这里:提示改用键盘自带语音输入
      Alert.alert('语音识别不可用', '本机未提供中文语音识别服务,可长按键盘空格/麦克风用输入法语音。')
    }
  })
  useSpeechRecognitionEvent('end', () => setListening(false))
  async function toggleVoice() {
    if (listening) { ExpoSpeechRecognitionModule.stop(); return }
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
      if (!perm.granted) { Alert.alert('需要麦克风权限', '请在系统设置中允许白泽使用麦克风与语音识别。'); return }
      voiceBase.current = input ? input.replace(/\s+$/, '') + ' ' : ''
      setListening(true)
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN', interimResults: true, continuous: false,
        requiresOnDeviceRecognition: false, addsPunctuation: true,
      })
    } catch {
      setListening(false)
    }
  }

  // Android 键盘避让:监听键盘高度变化,手动 padding(Expo 默认 adjustResize 在部分机型不生效)
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const show = Keyboard.addListener('keyboardDidShow', (e) => { kbGap.current = e.endCoordinates.height })
    const hide = Keyboard.addListener('keyboardDidHide', () => { kbGap.current = 0 })
    return () => { show.remove(); hide.remove() }
  }, [])

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
    setAttachErr(null)
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/msword',
             'text/plain', 'text/markdown', 'text/csv', 'text/comma-separated-values'],
      copyToCacheDirectory: true,
    })
    if (r.canceled || !r.assets?.length) return
    const f = r.assets[0]
    const fname = f.name || '附件'
    if ((f.size || 0) > 10 * 1024 * 1024) { setAttachErr({ name: fname, msg: '文件超过 10MB,请精简后重试' }); return }
    setAttachBusy(true)
    try {
      const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 })
      const out = await cnFileExtract(fname, b64)
      if (!out.ok || !out.text) {
        // 失败也把文件名与原因留在预览条,用户知道是哪个文件、为什么失败、怎么办
        const hint = /doc/i.test(fname) && !/docx/i.test(fname)
          ? '旧版 .doc:请用 WPS/Word 另存为 .docx 后重传'
          : /扫描|图片型/.test(out.error || '') ? '扫描件/图片型:可用 📷 拍照走视觉模型看图'
          : (out.error || '请换用文本内容粘贴')
        setAttachErr({ name: fname, msg: hint })
        return
      }
      setAttach({ name: fname, chars: out.chars || out.text.length, text: out.text })
    } catch (e) {
      setAttachErr({ name: fname, msg: e instanceof Error ? e.message : '读取失败,请重试' })
    } finally {
      setAttachBusy(false)
    }
  }

  // 拍照输入:相机 → 原图挂为图片附件(发送时由千问 VL 视觉模型直接看图)
  async function pickCamera() {
    if (attachBusy || busy) return
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('需要相机权限', '请在系统设置中允许白泽使用相机。'); return }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
    if (r.canceled || !r.assets?.[0]?.base64) return
    setImgAttach(r.assets[0].base64!)
  }

  // 图片输入:相册选图 → 图片附件(看图理解,非仅文字提取)
  async function pickAlbum() {
    if (attachBusy || busy) return
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true, mediaTypes: ['images'] })
    if (r.canceled || !r.assets?.[0]?.base64) return
    setImgAttach(r.assets[0].base64!)
  }

  async function send() {
    const text = input.trim()
    if (busy) return
    if (!text && !imgAttach) return
    const attachTag = attach ? `\n📎 已附文件「${attach.name}」(${attach.chars} 字)` : ''
    const userB: Bubble = { role: 'user', content: imgAttach ? (text || '(图片)') : (text + attachTag), ts: Date.now() }
    const next = [...messages, userB]
    const imgB64 = imgAttach
    const mLabel = imgB64 ? '千问 VL Max' : (CN_MODELS.find((m) => m.id === model)?.name || model)
    setMessages(next); void persistConv(next); setInput(''); setBusy(true)
    // 图片附件随本轮发送即清;失败提示条一并清
    setImgAttach(null)
    setAttachErr(null)
    // 组装消息:图片 → 多模态 content 数组,模型强制走视觉(千问 VL Max)
    const apiMsgs: CnMessage[] = next.slice(-20).map((m, i) => {
      if (imgB64 && i === next.length - 1) {
        return { role: 'user', content: [
          { type: 'text', text: text || '请看这张图片' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imgB64 } },
        ] }
      }
      return { role: m.role, content: m.content }
    })
    // 文档附件上下文注入(与网页端同款:用一次即清)
    if (attach) {
      apiMsgs.unshift({ role: 'system', content: '以下是用户上传的文件内容,作为回答的参考依据:\n\n' + attach.text.slice(0, 6000) })
      setAttach(null)
    }
    // 图片消息走非流式(视觉模型,链路简单可靠);纯文本保持流式优先
    if (imgB64) {
      try {
        const r = await cnChat('qwen-vl-max', apiMsgs)
        const finalMsgs = [...next, { role: 'assistant' as const, content: r.content || '(空响应)', ts: Date.now(), model: mLabel }]
        setMessages(finalMsgs); void persistConv(finalMsgs)
      } catch (e2) {
        const err2 = e2 as Error & { status?: number; quota?: boolean }
        if (err2.status === 401) {
          await cnLogout()
          const { useRouter } = await import('expo-router')
          useRouter().replace('/(auth)/login')
          return
        }
        const cleanQuota = (m: string) => (Platform.OS === 'ios' ? String(m).replace(/。?(升级|详见).*/g, '。') : m)
        const errMsg = err2.quota ? cleanQuota(err2.message || '网络异常,请重试') : (err2.message || '网络异常,请重试')
        const withErr = [...next, { role: 'assistant' as const, content: '⚠️ ' + errMsg, ts: Date.now() }]
        setMessages(withErr); void persistConv(withErr)
        if (err2.quota) Alert.alert('额度已用完', errMsg)
      } finally {
        setBusy(false); cnActiveCleanup()
      }
      return
    }

    // 流式优先(cn-stream SSE 逐字);一字未出即失败 → 降级非流式;中途断流 → 保留已生成
    let acc = ''
    let streamed = false
    try {
      for await (const delta of cnStreamChat(model, apiMsgs)) {
        streamed = true
        acc += delta
        const draft = [...next, { role: 'assistant' as const, content: acc, ts: Date.now(), model: mLabel }]
        setMessages(draft)
      }
      const finalMsgs = [...next, { role: 'assistant' as const, content: acc || '(空响应)', ts: Date.now(), model: mLabel }]
      setMessages(finalMsgs); void persistConv(finalMsgs)
    } catch (e) {
      const err = e as Error & { status?: number; quota?: boolean }
      if (err.message === CN_USER_STOP) {
        // 用户主动停止:保留已生成部分
        if (acc) { const kept = [...next, { role: 'assistant' as const, content: acc, ts: Date.now(), model: mLabel }]; setMessages(kept); void persistConv(kept) }
      } else if (!streamed) {
        // 流式通道不可用/前置报错 → 非流式降级(服务端前置校验错误会在这里重新抛出)
        try {
          const r = await cnChat(model, apiMsgs)
          const finalMsgs = [...next, { role: 'assistant' as const, content: r.content, ts: Date.now(), model: mLabel }]
          setMessages(finalMsgs); void persistConv(finalMsgs)
        } catch (e2) {
          const err2 = e2 as Error & { status?: number; quota?: boolean }
          if (err2.status === 401) {
            await cnLogout()
            const { useRouter } = await import('expo-router')
            useRouter().replace('/(auth)/login')
            return
          }
          // iOS 提审口径:额度话术去掉「定价/升级」引导(Guideline 3.1.1),只留事实陈述
          const cleanQuota = (m: string) => (Platform.OS === 'ios' ? String(m).replace(/。?(升级|详见).*/g, '。') : m)
          const errMsg = err2.quota ? cleanQuota(err2.message || '网络异常,请重试') : (err2.message || '网络异常,请重试')
          const withErr = [...next, { role: 'assistant' as const, content: '⚠️ ' + errMsg, ts: Date.now() }]
          setMessages(withErr); void persistConv(withErr)
          if (err2.quota) Alert.alert('额度已用完', errMsg)
        }
      } else {
        // 中途断流:保留已生成内容并标注
        const kept = [...next, { role: 'assistant' as const, content: acc + '\n\n(网络中断,内容可能不完整)', ts: Date.now(), model: mLabel }]
        setMessages(kept); void persistConv(kept)
      }
    } finally {
      setBusy(false); cnActiveCleanup()
    }
  }

  function stop() { cnStopStream() }

  // 重新生成(长按消息「刷新」入口):掐掉尾部助手回复,复用历史重发最后一条用户消息
  async function regenerate() {
    if (busy || !messages.length) return
    let hist = [...messages]
    while (hist.length && hist[hist.length - 1].role === 'assistant') hist.pop()
    const lastUser = hist[hist.length - 1]
    if (!lastUser) return
    setMessages(hist); setInput(lastUser.content.replace(/\n📎 已附文件「[^」]*」.*$/m, '').trim())
    setBusy(true)
    try {
      const apiMsgs: CnMessage[] = hist.slice(-20).map((m) => ({ role: m.role, content: m.content }))
      const r = await cnChat(model, apiMsgs)
      const finalMsgs = [...hist, { role: 'assistant' as const, content: r.content || '(空响应)', ts: Date.now(), model: CN_MODELS.find((mm) => mm.id === model)?.name || model }]
      setMessages(finalMsgs); void persistConv(finalMsgs)
    } catch (e2) {
      const err2 = e2 as Error & { status?: number }
      if (err2.status === 401) { await cnLogout(); const { useRouter } = await import('expo-router'); useRouter().replace('/(auth)/login'); return }
      setMessages([...hist, { role: 'assistant' as const, content: '⚠️ ' + (err2.message || '网络异常,请重试'), ts: Date.now() }]); void persistConv(hist)
    } finally {
      setBusy(false); setInput('')
    }
  }

  // 长按消息弹窗(复制/刷新):位置随气泡,点任意处关闭
  function openCtx(e: { pageX: number; pageY: number }, item: Bubble, isLastAssistant: boolean) {
    setCtxMsg({ x: e.pageX, y: e.pageY, content: item.content, canRefresh: isLastAssistant && !busy })
  }
  async function ctxCopy() {
    if (!ctxMsg) return
    try { await Clipboard.setStringAsync(ctxMsg.content); setTip('已复制'); setTimeout(() => setTip(null), 1200) } catch {}
    setCtxMsg(null)
  }

  function clearChat() {
    Alert.alert('清空当前对话', '确定清空?(仅清本机当前会话)', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: newConversation },
    ])
  }

  const modelInfo = CN_MODELS.find((m) => m.id === model) || CN_MODELS[0]

  return (
    <KeyboardAvoidingView style={[s.wrap, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
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
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        onScroll={(e) => {
          // 距底部 <80px 时视为"在底部"(流式输出中自动跟随)
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
          const atBottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 80
          listRef.current?.setNativeProps({ atBottom })
        }}
        scrollEventThrottle={100}
        ListEmptyComponent={
          <View style={s.empty}>
            <Image source={require('../../assets/icon.png')} style={s.emptyLogo} />
            <Text style={s.emptyTx}>你好,我是白泽 AI 助手。写作、分析、翻译、编程都能帮上忙。</Text>
            <Text style={s.emptySub}>已备案国产大模型 · 数据存储于境内</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onLongPress={(e) => openCtx({ pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY }, item,
              item.role === 'assistant' && !messages.slice(index + 1).some((m) => m.role === 'assistant'))}
            delayLongPress={350}
            style={item.role === 'user' ? s.bubbleUserWrap : s.bubbleAiWrap}
          >
            <View style={[s.bubble, item.role === 'user' ? s.bubbleUser : s.bubbleAi]}>
              <Text style={item.role === 'user' ? s.bubbleUserTx : s.bubbleAiTx}>{item.content}</Text>
              {item.role === 'assistant' && item.model ? (
                <Text style={s.modelBadge}>✦ {item.model}</Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />

      {/* 长按弹窗:复制 / 刷新(仅最后一条助手回复可刷新;位置随气泡,点任意处关) */}
      {ctxMsg && (
        <Pressable style={s.ctxMask} onPress={() => setCtxMsg(null)}>
          <View style={[s.ctxPop, { top: Math.max(60, ctxMsg.y - 64), left: Math.max(16, Math.min(ctxMsg.x - 70, 9999)) }]}>
            <Pressable style={s.ctxItem} onPress={ctxCopy}>
              <Text style={s.ctxIco}>📋</Text><Text style={s.ctxTx}>复制</Text>
            </Pressable>
            {ctxMsg.canRefresh ? (
              <View style={s.ctxDiv} />
            ) : null}
            {ctxMsg.canRefresh ? (
              <Pressable style={s.ctxItem} onPress={() => { setCtxMsg(null); void regenerate() }}>
                <Text style={s.ctxIco}>🔄</Text><Text style={s.ctxTx}>刷新</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      )}

      {/* 轻提示(复制成功等) */}
      {tip ? <View style={s.tipPop}><Text style={s.tipTx}>{tip}</Text></View> : null}

      {/* 附件预览条(图片=视觉理解;文档=文本提取;失败=红条留名+原因+建议) */}
      {attachErr && (
        <View style={[s.attachBar, { borderColor: 'rgba(224,86,86,.4)', backgroundColor: 'rgba(224,86,86,.06)' }]}>
          <Text style={s.attachTx} numberOfLines={2}>📎 {attachErr.name} ✗ {attachErr.msg}</Text>
          <TouchableOpacity onPress={() => setAttachErr(null)} style={{ padding: 4 }}>
            <Text style={{ color: C.red, fontSize: 12 }}>✕ 关闭</Text>
          </TouchableOpacity>
        </View>
      )}
      {imgAttach && (
        <View style={[s.attachBar, { borderColor: 'rgba(64,150,255,.4)' }]}>
          <Text style={s.attachTx} numberOfLines={1}>🖼️ 图片已附加 · 发送后由视觉模型看图 (可不配文字直接发送)</Text>
          <TouchableOpacity onPress={() => setImgAttach(null)} style={{ padding: 4 }}>
            <Text style={{ color: C.red, fontSize: 12 }}>✕ 移除</Text>
          </TouchableOpacity>
        </View>
      )}
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
        {/* 豆包式输入卡:「+」集中附件入口 + 微信式三弧语音图标 */}
        <View style={s.inputCard}>
          {/* 「+」展开的附件菜单(文件/图片/拍照) */}
          {plusOpen && (
            <View style={s.plusMenu}>
              <TouchableOpacity style={s.plusItem} onPress={() => { setPlusOpen(false); void pickAttachment() }}>
                <Text style={s.plusIco}>📎</Text><Text style={s.plusTx}>文件</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.plusItem} onPress={() => { setPlusOpen(false); void pickAlbum() }}>
                <Text style={s.plusIco}>🖼️</Text><Text style={s.plusTx}>图片</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.plusItem} onPress={() => { setPlusOpen(false); void pickCamera() }}>
                <Text style={s.plusIco}>📷</Text><Text style={s.plusTx}>拍照</Text>
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            style={s.input}
            placeholder={listening ? '正在聆听,请说话…' : '输入问题,或点 + 附加文件/图片…'}
            placeholderTextColor={listening ? C.teal : C.muted}
            multiline
            value={input}
            onChangeText={setInput}
          />
          <View style={s.toolRow}>
            <TouchableOpacity style={[s.toolBtn, plusOpen && { backgroundColor: C.tealDim }]} onPress={() => setPlusOpen(v => !v)} disabled={busy} activeOpacity={0.7}>
              {attachBusy ? <ActivityIndicator size="small" color={C.teal} /> : (
                <Text style={{ fontSize: 22, lineHeight: 26, color: plusOpen ? C.teal : C.muted, fontWeight: '300' }}>{plusOpen ? '×' : '+'}</Text>
              )}
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={[s.toolBtn, listening && { backgroundColor: C.tealDim }]} onPress={toggleVoice} disabled={busy} activeOpacity={0.7}>
              {/* 语音图标(用户原图重绘:闭合圆环+声源圆点+双声波弧;tintColor 随聆听态变色) */}
              <Image source={require('../../assets/voice-icon.png')} style={{ width: 22, height: 22, tintColor: listening ? C.teal : C.muted }} />
            </TouchableOpacity>
            {busy ? (
              <TouchableOpacity style={[s.sendBtn, { backgroundColor: C.red }]} onPress={stop} activeOpacity={0.8}>
                <Text style={s.sendTx}>■</Text>
              </TouchableOpacity>
            ) : listening ? (
              <TouchableOpacity style={s.sendBtn} onPress={toggleVoice} activeOpacity={0.8}>
                <Text style={s.sendTx}>✓</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.sendBtn} onPress={send} disabled={!input.trim() && !imgAttach && !attach} activeOpacity={0.8}>
                <Text style={s.sendTx}>↑</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
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
  emptyLogo: { width: 72, height: 72, borderRadius: 18 },
  emptyTx: { color: C.text, fontSize: 14, textAlign: 'center', marginTop: 14, lineHeight: 22 },
  emptySub: { color: C.muted, fontSize: 12, marginTop: 8 },
  modelBadge: { color: C.muted, fontSize: 11, marginTop: 8, alignSelf: 'flex-start' },
  bubble: { borderRadius: 12, padding: 12, marginBottom: 10 },
  bubbleUserWrap: { alignSelf: 'flex-end', maxWidth: '88%' },
  bubbleAiWrap: { alignSelf: 'stretch' },
  bubbleUser: { backgroundColor: C.tealDim, borderWidth: 1, borderColor: 'rgba(26,235,168,.25)' },
  bubbleAi: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  bubbleUserTx: { color: C.text, fontSize: 14, lineHeight: 21 },
  bubbleAiTx: { color: C.text, fontSize: 15, lineHeight: 23 },
  inputRow: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  inputCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  input: { color: C.text, fontSize: 16, minHeight: 44, maxHeight: 130, lineHeight: 22, padding: 0 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  toolBtn: { minWidth: 38, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  toolIco: { fontSize: 18 },
  sendBtn: { minWidth: 42, height: 34, borderRadius: 9, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  sendTx: { color: '#04140e', fontSize: 18, fontWeight: '700' },
  // 「+」附件菜单(输入卡内展开)
  plusMenu: { flexDirection: 'row', gap: 8, marginBottom: 8, paddingTop: 2 },
  plusItem: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,.04)', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 18 },
  plusIco: { fontSize: 20 },
  plusTx: { color: C.text, fontSize: 11.5, marginTop: 3 },
  // 长按弹窗(复制/刷新)+ 轻提示
  ctxMask: { position: 'absolute', inset: 0, zIndex: 90 },
  ctxPop: { position: 'absolute', flexDirection: 'row', alignItems: 'center', backgroundColor: '#1b2621', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  ctxItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  ctxIco: { fontSize: 15 },
  ctxTx: { color: C.text, fontSize: 13 },
  ctxDiv: { width: 1, height: 18, backgroundColor: C.border },
  tipPop: { position: 'absolute', left: 0, right: 0, bottom: 120, alignItems: 'center', zIndex: 95, pointerEvents: 'none' },
  tipTx: { color: '#fff', fontSize: 12.5, backgroundColor: 'rgba(0,0,0,.72)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99 },
  histMask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.55)', zIndex: 30, justifyContent: 'center', padding: 20 },
  histPanel: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, maxHeight: 460 },
  histTitle: { color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  histEmpty: { color: C.muted, fontSize: 13, textAlign: 'center', padding: 20 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginBottom: 4 },
  histRowOn: { backgroundColor: C.tealDim },
  histName: { color: C.text, fontSize: 13.5 },
  histMeta: { color: C.muted, fontSize: 11, marginTop: 2 },
  histDel: { padding: 8 },
  attachBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.card, borderWidth: 1, borderColor: 'rgba(26,235,168,.25)', borderRadius: 10 },
  attachTx: { color: C.text, fontSize: 12, flex: 1 },
})
