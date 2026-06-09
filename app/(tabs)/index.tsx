import { useState, useRef, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
  Modal, Pressable, Linking, Image, Keyboard, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker    from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem     from 'expo-file-system'
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition'
import { supabase }                  from '../../lib/supabase'
import { streamChat, MODELS, CHAT_LANGS, messageText, contentImages } from '../../lib/api'
import type { Message, ContentPart } from '../../lib/api'
import { getSecret }                 from '../../lib/secureSettings'

// Chat input attachments (images go to vision models; text files are inlined)
type Attachment =
  | { kind: 'image'; uri: string; dataUrl: string }
  | { kind: 'file';  name: string; text: string }

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0C0D16',
  bg2:     '#13152A',
  bg3:     '#1C1E35',
  bg4:     '#24263E',
  border:  '#252845',
  border2: '#303358',
  text:    '#E4E4EA',
  muted:   '#606070',
  dim:     '#38383F',
  teal:    '#1AEBA8',
  teal2:   '#0F8C63',
  teal3:   '#083D2B',
  red:     '#E8453C',
}

const SUGGESTIONS = [
  'Explain quantum computing simply',
  'Write a Python web scraper',
  'Review and improve my code',
  'Draft a professional email',
]

// Map chat response-language code → BCP-47 locale for speech recognition
const STT_LANG: Record<string, string> = {
  '': 'en-US', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', vi: 'vi-VN',
  th: 'th-TH', ms: 'ms-MY', id: 'id-ID', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA',
}

export default function ChatScreen() {
  const router = useRouter()
  const [guest,       setGuest]       = useState(false)   // anonymous user → free models only
  const [model,       setModel]       = useState('deepseek-v3')
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const [error,       setError]       = useState('')
  const [showModels,  setShowModels]  = useState(false)
  const [showLangs,   setShowLangs]   = useState(false)
  const [responseLang,  setResponseLang]  = useState('')      // '' = auto
  const [customApiUrl,  setCustomApiUrl]  = useState('')
  const [customApiKey,  setCustomApiKey]  = useState('')
  const [convTitle,     setConvTitle]     = useState('')      // conversation display name
  const [showRename,    setShowRename]    = useState(false)
  const [renameInput,   setRenameInput]   = useState('')
  const [deleteLocked,  setDeleteLocked]  = useState(true)   // delete protection ON by default
  const [attachments,   setAttachments]   = useState<Attachment[]>([])
  const [showAttach,    setShowAttach]    = useState(false)
  const [listening,     setListening]     = useState(false)   // voice input active
  const voiceBaseRef = useRef('')          // input text captured when voice started
  const listRef    = useRef<FlatList>(null)
  const lockTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const curModel = MODELS.find(m => m.id === model) ?? MODELS[0]
  const curLang  = CHAT_LANGS.find(l => l.code === responseLang) ?? CHAT_LANGS[0]
  const showExternalBilling = Platform.OS !== 'ios'
  // iOS ships as a free-only build (no paid models / purchases shown → App Store
  // Guideline 2.1(b)/3.1.1). On Android, premium models are available to signed-in
  // users; guests get free models only.
  const freeOnly      = Platform.OS === 'ios' || guest
  const visibleModels = Platform.OS === 'ios' ? MODELS.filter(m => m.free) : MODELS

  // Load persisted state
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('mobile_messages'),
      AsyncStorage.getItem('response_lang'),
      AsyncStorage.getItem('custom_api_url'),
      getSecret('custom_api_key'),
      AsyncStorage.getItem('conv_title'),
    ]).then(([msgs, lang, apiUrl, apiKey, title]) => {
      if (msgs) setMessages(JSON.parse(msgs))
      if (lang) setResponseLang(lang)
      if (apiUrl) setCustomApiUrl(apiUrl)
      if (apiKey) setCustomApiKey(apiKey)
      if (title) setConvTitle(title)
    })
  }, [])

  // Detect guest (anonymous) users
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setGuest(!!user?.is_anonymous)
    })
  }, [])

  async function openAuth() {
    if (guest) await supabase.auth.signOut()
    router.push('/(auth)/login')
  }

  // ── Voice input (on-device speech-to-text) ───────────────────────
  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results?.[0]?.transcript ?? ''
    const base = voiceBaseRef.current
    setInput((base ? base + ' ' : '') + t)
  })
  useSpeechRecognitionEvent('end', () => setListening(false))
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false)
    if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
      setError(`Voice input: ${e.message || e.error}`)
    }
  })

  async function toggleVoice() {
    if (listening) { try { ExpoSpeechRecognitionModule.stop() } catch {} setListening(false); return }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Microphone access needed', 'Enable microphone & speech recognition in Settings to dictate messages.')
      return
    }
    voiceBaseRef.current = input.trim()
    setError('')
    setListening(true)
    try {
      ExpoSpeechRecognitionModule.start({
        lang: STT_LANG[responseLang] ?? 'en-US',
        interimResults: true,
        continuous: false,
      })
    } catch {
      setListening(false)
      setError('Voice input is unavailable on this device.')
    }
  }

  // Keep the selected model within the free set whenever restricted
  // (always on iOS; for guests on Android) — e.g. after loading an old conversation.
  useEffect(() => {
    if (freeOnly && !(MODELS.find(x => x.id === model)?.free)) {
      setModel(MODELS.find(x => x.free)?.id ?? model)
    }
  }, [freeOnly, model])

  // Pick a model from the sheet; guests can't select locked (premium) models
  function selectModel(m: typeof MODELS[number]) {
    if (guest && !m.free) {
      Alert.alert(
        'Sign in to unlock',
        `${m.name} is available with an account. Free models are available to guests — sign in or create a free account to use all models.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Sign in', onPress: () => { setShowModels(false); void openAuth() } },
        ],
      )
      return
    }
    setModel(m.id)
    setShowModels(false)
  }

  // ── Attachments (photo / camera / file) ──────────────────────────
  // When an image is attached but the current model can't see images,
  // auto-switch to the best available vision model (respects free-only).
  function ensureVisionModel() {
    if (curModel.vision) return
    const v = visibleModels.find(m => m.vision)
    if (v) setModel(v.id)
  }

  function addImage(asset: ImagePicker.ImagePickerAsset) {
    const mime    = asset.mimeType ?? 'image/jpeg'
    const dataUrl = asset.base64 ? `data:${mime};base64,${asset.base64}` : asset.uri
    setAttachments(prev => [...prev, { kind: 'image', uri: asset.uri, dataUrl }])
    ensureVisionModel()
  }

  async function pickPhoto() {
    setShowAttach(false)
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6,
    })
    if (!res.canceled && res.assets[0]) addImage(res.assets[0])
  }

  async function takePhoto() {
    setShowAttach(false)
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.'); return }
    const res = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 })
    if (!res.canceled && res.assets[0]) addImage(res.assets[0])
  }

  async function pickFile() {
    setShowAttach(false)
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/*', 'application/json', 'application/javascript', 'application/xml'],
      copyToCacheDirectory: true,
    })
    if (res.canceled || !res.assets[0]) return
    const f = res.assets[0]
    try {
      const text = await FileSystem.readAsStringAsync(f.uri)
      if (text.length > 200_000) { Alert.alert('File too large', 'Please attach a text file under ~200 KB.'); return }
      setAttachments(prev => [...prev, { kind: 'file', name: f.name, text }])
    } catch {
      Alert.alert('Could not read file', 'Only text/code files are supported for now.')
    }
  }

  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, idx) => idx !== i))
  }

  const send = useCallback(async (text?: string) => {
    const trimmed = (text ?? input).trim()
    if ((!trimmed && attachments.length === 0) || streaming) return
    setError(''); setInput(''); Keyboard.dismiss()
    try { ExpoSpeechRecognitionModule.stop() } catch {} setListening(false)

    // Build content: plain string, or multimodal parts when attachments exist
    let content: string | ContentPart[]
    if (attachments.length > 0) {
      const parts: ContentPart[] = []
      for (const a of attachments) {
        if (a.kind === 'image') parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
        else parts.push({ type: 'text', text: `[File: ${a.name}]\n${a.text}` })
      }
      if (trimmed) parts.push({ type: 'text', text: trimmed })
      content = parts
    } else {
      content = trimmed
    }
    const hadAttachments = attachments.length > 0
    setAttachments([])

    // Auto-set conversation title from first user message
    if (messages.length === 0 && !convTitle) {
      const autoTitle = (messageText(content) || (hadAttachments ? 'Image chat' : '')).slice(0, 40)
      if (autoTitle) { setConvTitle(autoTitle); AsyncStorage.setItem('conv_title', autoTitle) }
    }

    const userMsg: Message     = { role: 'user', content }
    const asstSlot: Message    = { role: 'assistant', content: '' }
    const nextMsgs             = [...messages, userMsg, asstSlot]
    setMessages(nextMsgs)
    setStreaming(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('Not authenticated'); setStreaming(false); return }

    try {
      for await (const delta of streamChat({
        accessToken:  session.access_token,
        model,
        messages:     [...messages, userMsg],
        responseLang: responseLang || undefined,
        customApiUrl: customApiUrl || undefined,
        customApiKey: customApiKey || undefined,
      })) {
        setMessages(prev => {
          const updated = prev.map((m, i) =>
            i === prev.length - 1
              ? { ...m, content: (typeof m.content === 'string' ? m.content : '') + delta }
              : m
          )
          AsyncStorage.setItem('mobile_messages', JSON.stringify(updated.slice(-120)))
          return updated
        })
        listRef.current?.scrollToEnd({ animated: false })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
      setMessages(prev => prev.slice(0, -1))
    } finally { setStreaming(false) }
  }, [input, streaming, messages, model, responseLang, customApiUrl, customApiKey, convTitle, attachments])

  function clearChat() {
    setMessages([])
    setConvTitle('')
    AsyncStorage.multiRemove(['mobile_messages', 'conv_title'])
    relock()
  }

  // ── Delete lock helpers ──────────────────────────────────────
  function unlock() {
    if (lockTimer.current) clearTimeout(lockTimer.current)
    setDeleteLocked(false)
    lockTimer.current = setTimeout(() => setDeleteLocked(true), 15000)
  }

  function relock() {
    if (lockTimer.current) clearTimeout(lockTimer.current)
    setDeleteLocked(true)
  }

  // ── Export conversation ──────────────────────────────────────
  function exportConversation() {
    if (messages.length === 0) return
    const lines = messages.map(m =>
      `${m.role === 'user' ? 'You' : 'AI'}: ${messageText(m.content)}${contentImages(m.content).length ? '  [📷 image]' : ''}`
    ).join('\n\n---\n\n')
    const content = `# ${convTitle || 'Bayze Chat'}\n\n${lines}`
    // Share via native share sheet
    import('react-native').then(({ Share }) => {
      Share.share({ message: content, title: convTitle || 'Bayze Chat' })
    })
  }

  function saveRename() {
    const t = renameInput.trim()
    if (t) {
      setConvTitle(t)
      AsyncStorage.setItem('conv_title', t)
    }
    setShowRename(false)
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        {/* Left: Bayze logo + model picker */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={s.headerLogo}>
            <Image source={require('../../assets/bayze-logo.png')} style={s.headerLogoImg} resizeMode="contain" />
          </View>
          <TouchableOpacity
            onPress={() => setShowModels(true)}
            style={s.modelBtn}
            activeOpacity={0.7}
          >
            <Text style={s.modelName} numberOfLines={1}>{curModel.name}</Text>
            {curModel.free && <Text style={s.freeBadge}>Free</Text>}
            <Text style={s.modelChevron}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* Right: Lang + Top-up + Clear */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity onPress={() => setShowLangs(true)} style={s.iconBtn} activeOpacity={0.7}>
            <Text style={s.iconBtnText}>🌐</Text>
            {responseLang ? <Text style={s.langDot} /> : null}
          </TouchableOpacity>
          {showExternalBilling && (
            <TouchableOpacity
              onPress={() => Linking.openURL('https://app.lanwealth.com/dashboard/billing')}
              style={[s.iconBtn, { paddingHorizontal: 10 }]} activeOpacity={0.7}
            >
              <Text style={[s.iconBtnText, { color: C.teal, fontSize: 12 }]}>充值 +</Text>
            </TouchableOpacity>
          )}
          {/* 🗑 moved to title bar below */}
        </View>
      </View>

      {/* ── Active conversation title bar + status strip ──────────────────── */}
      {messages.length > 0 && (
        <View>
          {/* Title row: conversation name + rename + export + delete-lock */}
          <View style={s.titleBar}>
            <Text style={s.titleBarText} numberOfLines={1}>
              {convTitle || 'New Chat'}
            </Text>
            {/* Rename */}
            <TouchableOpacity
              onPress={() => { setRenameInput(convTitle); setShowRename(true) }}
              style={s.titleBarIconBtn} activeOpacity={0.7}
            >
              <Text style={s.titleBarIcon}>✏</Text>
            </TouchableOpacity>
            {/* Export */}
            <TouchableOpacity onPress={exportConversation} style={s.titleBarIconBtn} activeOpacity={0.7}>
              <Text style={[s.titleBarIcon, { fontSize: 14 }]}>↑</Text>
            </TouchableOpacity>
            {/* Delete lock — tap lock icon to unlock, then tap again to delete */}
            <TouchableOpacity
              onPress={() => deleteLocked ? unlock() : clearChat()}
              style={s.titleBarIconBtn} activeOpacity={0.7}
            >
              <Text style={[s.titleBarIcon, {
                color: deleteLocked ? C.teal : '#E8453C',
                opacity: deleteLocked ? 0.7 : 1,
              }]}>
                {deleteLocked ? '🔒' : '🗑'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Status row: model + new chat */}
          <View style={s.statusStrip}>
            <Text style={s.statusText} numberOfLines={1}>
              {curModel.name}{customApiUrl ? '  ·  Custom API' : '  ·  LanWealth'}
            </Text>
            <TouchableOpacity onPress={clearChat} activeOpacity={0.7}>
              <Text style={s.statusNewChat}>+ New chat</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      {messages.length === 0 ? (
        <View style={s.welcome}>
          <View style={s.welcomeLogoWrap}>
            <Image source={require('../../assets/bayze-logo.png')} style={s.welcomeLogoImg} resizeMode="contain" />
          </View>
          <View style={s.welcomeTitleRow}>
            <Text style={s.welcomeTitle}>Bayze</Text>
            <Text style={s.welcomeZh}>白泽</Text>
          </View>
          <Text style={s.welcomeSub}>
            {curModel.name}
            {responseLang ? `  ·  ${curLang.native}` : ''}
            {(customApiUrl && customApiKey) ? '  ·  Custom API' : ''}
          </Text>
          <View style={s.suggGrid}>
            {SUGGESTIONS.map(sg => (
              <TouchableOpacity key={sg} style={s.suggCard} onPress={() => send(sg)} activeOpacity={0.7}>
                <Text style={s.suggText}>{sg}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages.filter(m => m.role !== 'system')}
          keyExtractor={(_, i) => i.toString()}
          contentContainerStyle={s.msgList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: msg, index }) => (
            <View style={[
              s.msgRow,
              msg.role === 'user' ? s.userRow : s.asstRow,
            ]}>
              {msg.role === 'assistant' && (
                <View style={s.asstAvatar}>
                  <Image source={require('../../assets/bayze-logo.png')} style={{ width: 14, height: 14 }} resizeMode="contain" />
                </View>
              )}
              <View style={[
                s.bubble,
                msg.role === 'user' ? s.userBubble : s.asstBubble,
              ]}>
                {contentImages(msg.content).map((url, i) => (
                  <Image key={i} source={{ uri: url }} style={s.msgImage} resizeMode="cover" />
                ))}
                {messageText(msg.content)
                  ? <Text style={[s.msgText, msg.role === 'user' && s.userMsgText]} selectable>{messageText(msg.content)}</Text>
                  : (typeof msg.content === 'string' && msg.content === ''
                      ? <Text style={{ color: C.teal, fontSize: 16 }}>▌</Text>
                      : null)
                }
                {msg.role === 'assistant' && streaming && index === messages.filter(m=>m.role!=='system').length - 1 && messageText(msg.content)
                  ? <Text style={{ color: C.teal }}>▌</Text> : null
                }
              </View>
              {msg.role === 'user' && (
                <View style={s.userAvatar}>
                  <Text style={{ fontSize: 11, color: C.teal }}>You</Text>
                </View>
              )}
            </View>
          )}
        />
      )}

      {error ? (
        <View style={s.errBar}>
          <Text style={s.errText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Attachment previews ────────────────────────────────────────────── */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={s.attachPreviewRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, alignItems: 'center' }}
        >
          {attachments.map((a, i) => (
            <View key={i} style={s.attachChip}>
              {a.kind === 'image'
                ? <Image source={{ uri: a.uri }} style={s.attachThumb} resizeMode="cover" />
                : <View style={s.attachFileChip}><Text style={s.attachFileName} numberOfLines={1}>📄 {a.name}</Text></View>}
              <TouchableOpacity style={s.attachRemove} onPress={() => removeAttachment(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.attachRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Input ──────────────────────────────────────────────────────────── */}
      <View style={s.inputRow}>
        <TouchableOpacity
          style={s.attachBtn} onPress={() => setShowAttach(true)}
          disabled={streaming} activeOpacity={0.7}
        >
          <Text style={s.attachBtnText}>＋</Text>
        </TouchableOpacity>
        <TextInput
          style={s.inputField}
          value={input} onChangeText={setInput}
          multiline
          placeholder={listening ? 'Listening…' : `Message ${curModel.name}…`}
          placeholderTextColor={C.dim}
          editable={!streaming}
        />
        <TouchableOpacity
          style={[s.attachBtn, listening && { backgroundColor: C.red, borderColor: C.red }]}
          onPress={toggleVoice} disabled={streaming} activeOpacity={0.7}
        >
          <Text style={[s.attachBtnText, { fontSize: listening ? 16 : 17 }, listening && { color: '#fff' }]}>
            {listening ? '■' : '🎤'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.sendBtn, ((!input.trim() && attachments.length === 0) || streaming) && s.sendBtnDisabled]}
          onPress={() => send()}
          disabled={(!input.trim() && attachments.length === 0) || streaming}
          activeOpacity={0.8}
        >
          {streaming
            ? <ActivityIndicator size="small" color="#050505" />
            : <Text style={s.sendArrow}>↑</Text>
          }
        </TouchableOpacity>
      </View>

      {/* ── Attach action sheet ────────────────────────────────────────────── */}
      <Modal visible={showAttach} transparent animationType="slide" onRequestClose={() => setShowAttach(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowAttach(false)}>
          <Pressable style={[s.sheet, { paddingBottom: 30 }]} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Add to message</Text>
            <TouchableOpacity style={s.attachAction} onPress={pickPhoto} activeOpacity={0.7}>
              <Text style={s.attachActionIcon}>🖼️</Text>
              <View><Text style={s.attachActionName}>Photo library</Text><Text style={s.sheetRowSub}>Attach an image to ask about it</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={s.attachAction} onPress={takePhoto} activeOpacity={0.7}>
              <Text style={s.attachActionIcon}>📷</Text>
              <View><Text style={s.attachActionName}>Take photo</Text><Text style={s.sheetRowSub}>Use the camera</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={[s.attachAction, { borderBottomWidth: 0 }]} onPress={pickFile} activeOpacity={0.7}>
              <Text style={s.attachActionIcon}>📄</Text>
              <View><Text style={s.attachActionName}>File</Text><Text style={s.sheetRowSub}>Text / code files</Text></View>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Rename Modal ──────────────────────────────────────────────────── */}
      <Modal visible={showRename} transparent animationType="fade" onRequestClose={() => setShowRename(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowRename(false)}>
          <Pressable style={[s.sheet, { paddingBottom: 24 }]} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Rename Conversation</Text>
            <TextInput
              style={[s.inputField, { marginHorizontal: 0, marginBottom: 16, backgroundColor: C.bg3, borderWidth: 1.5, borderColor: C.teal2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 }]}
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="Enter conversation name…"
              placeholderTextColor={C.dim}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={saveRename}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[{ flex: 1, backgroundColor: C.teal2, borderRadius: 9, padding: 13, alignItems: 'center' }]}
                onPress={saveRename} activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ flex: 1, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border2, borderRadius: 9, padding: 13, alignItems: 'center' }]}
                onPress={() => setShowRename(false)} activeOpacity={0.8}
              >
                <Text style={{ color: C.muted, fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Model Picker Modal ─────────────────────────────────────────────── */}
      <Modal visible={showModels} transparent animationType="slide" onRequestClose={() => setShowModels(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowModels(false)}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select Model</Text>
            {/* Model list — always accessible, no lock */}
            {messages.length > 0 && (
              <Text style={{ fontSize: 11, color: C.teal, textAlign: 'center', marginBottom: 8, opacity: 0.8 }}>
                ✦ New model will read previous messages
              </Text>
            )}
            {guest && Platform.OS !== 'ios' && (
              <Text style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginBottom: 8 }}>
                🔒 Premium models need an account — sign in to unlock all
              </Text>
            )}
            <ScrollView showsVerticalScrollIndicator={false}>
              {visibleModels.map(m => {
                const locked = guest && !m.free
                return (
                <TouchableOpacity
                  key={m.id}
                  style={[s.sheetRow, m.id === model && s.sheetRowActive, locked && { opacity: 0.4 }]}
                  onPress={() => selectModel(m)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[s.sheetRowName, m.id === model && { color: C.teal }]}>{m.name}</Text>
                      {m.free ? (
                        <View style={s.freePill}>
                          <Text style={s.freePillText}>Free</Text>
                        </View>
                      ) : locked ? (
                        <View style={s.lockPill}>
                          <Text style={s.lockPillText}>🔒 Sign in</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.sheetRowSub}>{m.group} · {m.tag}</Text>
                  </View>
                  {m.id === model && <Text style={{ color: C.teal, fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
                )
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Language Picker Modal ──────────────────────────────────────────── */}
      <Modal visible={showLangs} transparent animationType="slide" onRequestClose={() => setShowLangs(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowLangs(false)}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>AI Response Language</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {CHAT_LANGS.map(l => (
                <TouchableOpacity
                  key={l.code}
                  style={[s.sheetRow, l.code === responseLang && s.sheetRowActive]}
                  onPress={() => {
                    setResponseLang(l.code)
                    AsyncStorage.setItem('response_lang', l.code)
                    setShowLangs(false)
                  }}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={[s.sheetRowName, l.code === responseLang && { color: C.teal }]}>
                      {l.native}
                    </Text>
                    {l.label !== l.native && (
                      <Text style={s.sheetRowSub}>{l.label}</Text>
                    )}
                  </View>
                  {l.code === responseLang && <Text style={{ color: C.teal, fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

    </KeyboardAvoidingView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Header
  header:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:14, paddingTop: Platform.OS==='ios' ? 54 : 14, paddingBottom:10, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border },
  headerLogo:   { width:28, height:28, borderRadius:7, backgroundColor:'rgba(255,255,255,0.9)', alignItems:'center', justifyContent:'center', padding:3 },
  headerLogoImg:{ width:22, height:22 },
  modelBtn:     { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, paddingHorizontal:10, paddingVertical:6, flexShrink:1 },
  modelName:    { fontSize:13, fontWeight:'600', color:C.text, flexShrink:1 },
  modelChevron: { fontSize:10, color:C.muted },
  freeBadge:    { fontSize:9, color:C.teal, backgroundColor:C.teal3, borderRadius:4, paddingHorizontal:4, paddingVertical:1, fontWeight:'600' },
  iconBtn:      { padding:7, borderRadius:7, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center', position:'relative' },
  iconBtnText:  { fontSize:14, color:C.muted },
  langDot:      { position:'absolute', top:4, right:4, width:6, height:6, borderRadius:3, backgroundColor:C.teal },

  // Title bar (conversation title + rename + delete)
  titleBar:       { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:7, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border, gap:6 },
  titleBarText:   { flex:1, fontSize:13, fontWeight:'600', color:C.text },
  titleBarIconBtn:{ padding:5, borderRadius:6 },
  titleBarIcon:   { fontSize:13, color:C.dim },

  // Status strip
  statusStrip:  { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:5, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border },
  statusText:   { fontSize:11, color:'#333', flex:1 },
  statusNewChat:{ fontSize:11, color:C.teal, fontWeight:'600', paddingLeft:10 },

  // Welcome
  welcome:         { flex:1, alignItems:'center', justifyContent:'center', padding:24 },
  welcomeLogoWrap: { width:72, height:72, borderRadius:18, backgroundColor:'rgba(255,255,255,0.92)', alignItems:'center', justifyContent:'center', marginBottom:14, padding:7 },
  welcomeLogoImg:  { width:58, height:58 },
  welcomeTitleRow: { flexDirection:'row', alignItems:'baseline', gap:8, marginBottom:6 },
  welcomeTitle:    { fontSize:24, fontWeight:'700', color:C.text },
  welcomeZh:       { fontSize:14, color:'rgba(255,255,255,0.3)', letterSpacing:.6 },
  welcomeSub:      { fontSize:13, color:C.muted, marginBottom:28, textAlign:'center' },
  suggGrid:        { width:'100%', flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'center' },
  suggCard:        { width:'47%', backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:10, padding:13 },
  suggText:        { fontSize:13, color:C.muted, lineHeight:19 },

  // Messages
  msgList:     { padding:16, paddingBottom:8, gap:14 },
  msgRow:      { flexDirection:'row', alignItems:'flex-end', gap:8 },
  userRow:     { flexDirection:'row-reverse', alignSelf:'flex-end', maxWidth:'88%' },
  asstRow:     { alignSelf:'flex-start', maxWidth:'88%' },
  asstAvatar:  { width:26, height:26, borderRadius:8, backgroundColor:'rgba(255,255,255,0.85)', alignItems:'center', justifyContent:'center', flexShrink:0, marginBottom:2, padding:4 },
  userAvatar:  { width:26, height:26, borderRadius:13, backgroundColor:C.teal3, borderWidth:1, borderColor:C.teal2, alignItems:'center', justifyContent:'center', flexShrink:0, marginBottom:2 },
  bubble:      { maxWidth:'100%' },
  userBubble:  { backgroundColor:C.teal2, borderRadius:16, borderBottomRightRadius:4, paddingHorizontal:14, paddingVertical:10 },
  asstBubble:  { backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:16, borderBottomLeftRadius:4, paddingHorizontal:14, paddingVertical:10 },
  msgText:     { fontSize:15, color:C.text, lineHeight:23 },
  userMsgText: { color:'#fff' },

  // Error
  errBar:  { margin:12, backgroundColor:'rgba(232,69,60,.1)', borderWidth:1, borderColor:'rgba(232,69,60,.3)', borderRadius:8, padding:10 },
  errText: { color:C.red, fontSize:13 },

  // Input
  inputRow:     { flexDirection:'row', alignItems:'flex-end', margin:12, gap:8, backgroundColor:C.bg3, borderWidth:1.5, borderColor:C.border2, borderRadius:14, padding:8, paddingLeft:14 },
  inputField:   { flex:1, color:C.text, fontSize:15, maxHeight:130, paddingVertical:4, lineHeight:22 },
  sendBtn:      { width:38, height:38, borderRadius:10, backgroundColor:C.teal, alignItems:'center', justifyContent:'center', flexShrink:0 },
  sendBtnDisabled: { opacity:0.3 },
  sendArrow:    { color:'#050505', fontSize:20, fontWeight:'800', marginTop:-1 },

  // Modals
  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end' },
  sheet:        { backgroundColor:C.bg2, borderTopLeftRadius:20, borderTopRightRadius:20, padding:20, paddingBottom:36, maxHeight:'75%' },
  sheetHandle:  { width:40, height:4, backgroundColor:C.border2, borderRadius:2, alignSelf:'center', marginBottom:16 },
  sheetTitle:   { fontSize:16, fontWeight:'700', color:C.text, marginBottom:14 },
  sheetRow:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:13, borderBottomWidth:1, borderBottomColor:C.border },
  sheetRowActive:{ backgroundColor:'rgba(26,235,168,0.04)', marginHorizontal:-4, paddingHorizontal:4, borderRadius:8 },
  sheetRowName: { fontSize:15, color:C.text, fontWeight:'500' },
  sheetRowSub:  { fontSize:12, color:C.muted, marginTop:2 },
  freePill:     { backgroundColor:C.teal3, borderRadius:5, paddingHorizontal:6, paddingVertical:2 },
  freePillText: { fontSize:10, color:C.teal, fontWeight:'600' },
  lockPill:     { backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2, borderRadius:5, paddingHorizontal:6, paddingVertical:2 },
  lockPillText: { fontSize:10, color:C.muted, fontWeight:'600' },

  // Message image (in-bubble thumbnail)
  msgImage:     { width:200, height:200, borderRadius:10, marginBottom:6, backgroundColor:C.bg4 },

  // Attachment previews (above input)
  attachPreviewRow: { maxHeight:78, marginBottom:-4 },
  attachChip:    { position:'relative' },
  attachThumb:   { width:60, height:60, borderRadius:10, backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2 },
  attachFileChip:{ height:60, maxWidth:160, paddingHorizontal:12, borderRadius:10, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center' },
  attachFileName:{ fontSize:12, color:C.text },
  attachRemove:  { position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:10, backgroundColor:'#000', borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center' },
  attachRemoveText:{ color:'#fff', fontSize:14, fontWeight:'700', marginTop:-2 },

  // Attach (+) button + action sheet
  attachBtn:     { width:38, height:38, borderRadius:10, backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center', flexShrink:0 },
  attachBtnText: { color:C.teal, fontSize:22, fontWeight:'600', marginTop:-2 },
  attachAction:  { flexDirection:'row', alignItems:'center', gap:14, paddingVertical:14, borderBottomWidth:1, borderBottomColor:C.border },
  attachActionIcon: { fontSize:22, width:30, textAlign:'center' },
  attachActionName: { fontSize:15, color:C.text, fontWeight:'500' },
})
