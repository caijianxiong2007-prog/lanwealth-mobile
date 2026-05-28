import { useState, useRef, useEffect }  from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native'
import { supabase }        from '../../lib/supabase'
import { streamChat, MODELS } from '../../lib/api'
import type { Message }     from '../../lib/api'
import AsyncStorage         from '@react-native-async-storage/async-storage'

const C = { bg:'#0A0A0B', bg2:'#111113', bg3:'#18181C', bg4:'#1E1E24', border:'#222228', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', dim:'#38383F', teal:'#1AEBA8', teal2:'#0F8C63', teal3:'#083D2B', red:'#E8453C' }

const SUGGESTIONS = [
  'Explain quantum computing simply',
  'Write a Python web scraper',
  'Review my code',
  'Draft a professional email',
]

export default function ChatScreen() {
  const [model,     setModel]     = useState('deepseek-v3')
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error,     setError]     = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const listRef = useRef<FlatList>(null)
  const curModel = MODELS.find(m => m.id === model) ?? MODELS[0]

  useEffect(() => {
    AsyncStorage.getItem('mobile_messages').then(raw => {
      if (raw) setMessages(JSON.parse(raw))
    })
  }, [])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || streaming) return
    setError(''); setInput('')

    const userMsg: Message = { role: 'user', content }
    const asstSlot: Message = { role: 'assistant', content: '' }
    const nextMsgs = [...messages, userMsg, asstSlot]
    setMessages(nextMsgs)
    setStreaming(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('Not authenticated'); setStreaming(false); return }

    try {
      for await (const delta of streamChat(session.access_token, model, [...messages, userMsg])) {
        setMessages(prev => {
          const updated = prev.map((m, i) => i === prev.length - 1 ? { ...m, content: m.content + delta } : m)
          AsyncStorage.setItem('mobile_messages', JSON.stringify(updated.slice(-100)))
          return updated
        })
        listRef.current?.scrollToEnd({ animated: false })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
      setMessages(prev => prev.slice(0, -1))
    } finally { setStreaming(false) }
  }

  function clearChat() { setMessages([]); AsyncStorage.removeItem('mobile_messages') }

  return (
    <KeyboardAvoidingView style={{ flex:1, backgroundColor:C.bg }} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?88:0}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => setShowPicker(v => !v)} style={s.modelBtn} activeOpacity={.7}>
          <Text style={s.modelBtnText}>{curModel.name}</Text>
          <Text style={s.modelTag}> {curModel.tag} ▾</Text>
        </TouchableOpacity>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={s.clearBtn} activeOpacity={.7}>
            <Text style={s.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Model picker */}
      {showPicker && (
        <ScrollView style={s.picker} contentContainerStyle={{ padding:8 }}>
          {MODELS.map(m => (
            <TouchableOpacity key={m.id} onPress={() => { setModel(m.id); setShowPicker(false) }}
              style={[s.pickerItem, m.id === model && { backgroundColor:C.bg4 }]} activeOpacity={.7}>
              <Text style={s.pickerName}>{m.name}</Text>
              <Text style={s.pickerTag}>{m.tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Messages */}
      {messages.length === 0 && !showPicker ? (
        <View style={s.welcome}>
          <View style={s.welcomeCircle} />
          <Text style={s.welcomeTitle}>LanWealth AI</Text>
          <Text style={s.welcomeSub}>Powered by {curModel.name}</Text>
          <View style={s.suggGrid}>
            {SUGGESTIONS.map(sg => (
              <TouchableOpacity key={sg} style={s.suggCard} onPress={() => send(sg)} activeOpacity={.7}>
                <Text style={s.suggText}>{sg}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList ref={listRef} data={messages} keyExtractor={(_, i) => i.toString()} contentContainerStyle={s.msgList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: msg, index }) => (
            <View style={[s.msgRow, msg.role==='user' ? s.userRow : s.asstRow]}>
              <View style={[s.avatar, msg.role==='user' ? s.userAv : s.asstAv]}>
                <Text style={{ fontSize:9, color: msg.role==='user'?C.teal:C.muted }}>{msg.role==='user'?'You':'AI'}</Text>
              </View>
              <View style={[s.bubble, msg.role==='user' ? s.userBubble : s.asstBubble]}>
                {msg.content
                  ? <Text style={s.msgText} selectable>{msg.content}</Text>
                  : <Text style={{ color:C.teal }}>▌</Text>
                }
                {msg.role==='assistant' && streaming && index===messages.length-1 && msg.content
                  ? <Text style={{ color:C.teal }}>▌</Text> : null
                }
              </View>
            </View>
          )}
        />
      )}

      {error ? (
        <View style={s.errBar}>
          <Text style={s.errText}>{error}</Text>
        </View>
      ) : null}

      {/* Input bar */}
      <View style={s.inputWrap}>
        <TextInput style={s.inputField} value={input} onChangeText={setInput} multiline
          placeholder={`Message ${curModel.name}…`} placeholderTextColor={C.dim}
          editable={!streaming} returnKeyType="default" />
        <TouchableOpacity style={[s.sendBtn, (!input.trim()||streaming) && { opacity:.3 }]}
          onPress={() => send()} disabled={!input.trim()||streaming} activeOpacity={.8}>
          {streaming
            ? <ActivityIndicator size="small" color="#050505" />
            : <Text style={s.sendArrow}>↑</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  header:       { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingTop:Platform.OS==='ios'?52:12, paddingBottom:10, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border },
  modelBtn:     { flex:1, flexDirection:'row', alignItems:'center', backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, paddingHorizontal:12, paddingVertical:7 },
  modelBtnText: { fontSize:14, fontWeight:'600', color:C.text },
  modelTag:     { fontSize:12, color:C.muted },
  clearBtn:     { marginLeft:10, paddingHorizontal:12, paddingVertical:7, borderWidth:1, borderColor:C.border, borderRadius:6 },
  clearBtnText: { fontSize:12, color:C.muted },
  picker:       { maxHeight:220, backgroundColor:C.bg2, borderBottomWidth:1, borderBottomColor:C.border },
  pickerItem:   { flexDirection:'row', justifyContent:'space-between', padding:12, borderRadius:6, marginBottom:2 },
  pickerName:   { fontSize:14, color:C.text },
  pickerTag:    { fontSize:12, color:C.muted },
  welcome:      { flex:1, alignItems:'center', justifyContent:'center', padding:24 },
  welcomeCircle:{ width:52, height:52, borderRadius:26, borderWidth:2, borderColor:C.teal2, backgroundColor:C.teal3, marginBottom:14 },
  welcomeTitle: { fontSize:22, fontWeight:'700', color:C.text, marginBottom:6 },
  welcomeSub:   { fontSize:13, color:C.muted, marginBottom:24 },
  suggGrid:     { width:'100%', flexDirection:'row', flexWrap:'wrap', gap:8, justifyContent:'center' },
  suggCard:     { width:'47%', backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, padding:12 },
  suggText:     { fontSize:13, color:C.muted, lineHeight:18 },
  msgList:      { padding:16, gap:16 },
  msgRow:       { flexDirection:'row', gap:10, maxWidth:'90%' },
  userRow:      { alignSelf:'flex-end', flexDirection:'row-reverse' },
  asstRow:      { alignSelf:'flex-start' },
  avatar:       { width:26, height:26, borderRadius:13, borderWidth:1, borderColor:C.border2, alignItems:'center', justifyContent:'center', flexShrink:0 },
  userAv:       { backgroundColor:C.teal3, borderColor:C.teal2 },
  asstAv:       { backgroundColor:C.bg4 },
  bubble:       { flex:1, maxWidth:'85%' },
  userBubble:   { backgroundColor:C.bg4, borderWidth:1, borderColor:C.border2, borderRadius:12, padding:10 },
  asstBubble:   { paddingTop:2 },
  msgText:      { fontSize:14, color:C.text, lineHeight:22 },
  errBar:       { margin:12, backgroundColor:'rgba(232,69,60,.1)', borderWidth:1, borderColor:'rgba(232,69,60,.3)', borderRadius:8, padding:10 },
  errText:      { color:C.red, fontSize:13 },
  inputWrap:    { flexDirection:'row', alignItems:'flex-end', margin:12, gap:8, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:12, padding:8, paddingLeft:14 },
  inputField:   { flex:1, color:C.text, fontSize:15, maxHeight:120, paddingVertical:4 },
  sendBtn:      { width:36, height:36, borderRadius:8, backgroundColor:C.teal, alignItems:'center', justifyContent:'center', flexShrink:0 },
  sendArrow:    { color:'#050505', fontSize:18, fontWeight:'700', marginTop:-1 },
})
