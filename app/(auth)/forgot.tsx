import { useState }         from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
         KeyboardAvoidingView, Platform, Image } from 'react-native'
import { useRouter }         from 'expo-router'
import { supabase }          from '../../lib/supabase'

const C = { bg:'#0A0A0B', bg2:'#111113', bg3:'#18181C', border:'#222228', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', teal:'#1AEBA8', red:'#E8453C' }

export default function ForgotScreen() {
  const router = useRouter()
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [sent,    setSent]    = useState(false)

  async function sendReset() {
    if (!email) return
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://app.lanwealth.com/auth/reset-password',
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSent(true)
  }

  return (
    <KeyboardAvoidingView style={{ flex:1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        <View style={s.logoWrap}>
          <View style={s.logoImgWrap}>
            <Image source={require('../../assets/bayze-logo.png')} style={s.logoImg} resizeMode="contain" />
          </View>
          <Text style={s.logoSub}>Reset your password</Text>
        </View>

        <View style={s.card}>
          {sent ? (
            <Text style={s.sentText}>
              If an account exists for {email.trim()}, we've sent a password reset link to that email.
              Open it to set a new password, then return here to sign in.
            </Text>
          ) : (
            <>
              <Text style={s.label}>Email</Text>
              <TextInput
                style={s.input} value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
                placeholderTextColor={C.muted} placeholder="your@email.com"
              />
              {error ? (
                <View style={s.errBox}><Text style={s.errText}>{error}</Text></View>
              ) : null}
              <TouchableOpacity
                style={[s.btn, loading && { opacity:.5 }]}
                onPress={sendReset} disabled={loading} activeOpacity={.8}
              >
                <Text style={s.btnText}>{loading ? 'Sending…' : 'Send reset link →'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity onPress={() => router.replace('/(auth)/login')} activeOpacity={.7} style={{ marginTop:20 }}>
          <Text style={[s.hint, { color:C.teal, fontWeight:'600' }]}>← Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container:   { flexGrow:1, backgroundColor:C.bg, alignItems:'center', justifyContent:'center', padding:24 },
  logoWrap:    { alignItems:'center', marginBottom:32 },
  logoImgWrap: { width:72, height:72, borderRadius:18, backgroundColor:'rgba(255,255,255,0.92)', alignItems:'center', justifyContent:'center', marginBottom:14, padding:7 },
  logoImg:     { width:58, height:58 },
  logoSub:     { fontSize:14, color:C.text, marginTop:2, fontWeight:'600' },
  card:        { width:'100%', maxWidth:360, backgroundColor:C.bg2, borderWidth:1, borderColor:C.border, borderRadius:14, padding:24 },
  label:       { fontSize:12, color:C.muted, marginBottom:6 },
  input:       { backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, padding:12, color:C.text, fontSize:15 },
  errBox:      { marginTop:12, backgroundColor:'rgba(232,69,60,.1)', borderWidth:1, borderColor:'rgba(232,69,60,.3)', borderRadius:6, padding:10 },
  errText:     { color:C.red, fontSize:13 },
  sentText:    { color:C.text, fontSize:14, lineHeight:21 },
  btn:         { marginTop:18, backgroundColor:C.teal, borderRadius:8, padding:13, alignItems:'center' },
  btnText:     { color:'#050505', fontWeight:'700', fontSize:15 },
  hint:        { fontSize:13, color:C.muted },
})
