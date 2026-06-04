import { useState }         from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
         KeyboardAvoidingView, Platform, Image, Linking } from 'react-native'
import { useRouter }         from 'expo-router'
import { supabase, signInAsGuest } from '../../lib/supabase'

const C = { bg:'#0A0A0B', bg2:'#111113', bg3:'#18181C', border:'#222228', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', teal:'#1AEBA8', teal2:'#0F8C63', teal3:'#083D2B', red:'#E8453C' }

export default function LoginScreen() {
  const router = useRouter()
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [showPw,  setShowPw]  = useState(false)
  const [loading, setLoading] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function signIn() {
    if (!email || !pass) return
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
    setLoading(false)
    if (err) setError(err.message)
  }

  async function continueAsGuest() {
    setGuestLoading(true); setError('')
    try {
      await signInAsGuest()          // RootLayout's auth listener routes to (tabs)
      router.replace('/(tabs)')
    } catch {
      setGuestLoading(false)
      setError('Guest mode is unavailable right now. Please sign in.')
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex:1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Bayze logo */}
        <View style={s.logoWrap}>
          <View style={s.logoImgWrap}>
            <Image
              source={require('../../assets/bayze-logo.png')}
              style={s.logoImg}
              resizeMode="contain"
            />
          </View>
          <View style={s.logoTextRow}>
            <Text style={s.logoText}>Bayze</Text>
            <Text style={s.logoZh}>白泽</Text>
          </View>
          <Text style={s.logoSub}>Sign in, or continue as a guest</Text>
        </View>

        {/* Card */}
        <View style={s.card}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input} value={email} onChangeText={setEmail}
            autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
            placeholderTextColor={C.muted} placeholder="your@email.com"
          />

          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'baseline', marginTop:14, marginBottom:6 }}>
            <Text style={s.label}>Password</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://app.lanwealth.com/auth/forgot-password')} activeOpacity={.7}>
              <Text style={s.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
          <View>
            <TextInput
              style={[s.input, { paddingRight: 44 }]}
              value={pass} onChangeText={setPass}
              secureTextEntry={!showPw}
              placeholderTextColor={C.muted} placeholder="••••••••"
            />
            <TouchableOpacity
              style={s.eyeBtn} onPress={() => setShowPw(v => !v)} activeOpacity={.7}
            >
              <Text style={{ fontSize:18 }}>{showPw ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={s.errBox}><Text style={s.errText}>{error}</Text></View>
          ) : null}

          <TouchableOpacity
            style={[s.btn, loading && { opacity:.5 }]}
            onPress={signIn} disabled={loading} activeOpacity={.8}
          >
            <Text style={s.btnText}>{loading ? 'Signing in…' : 'Sign in →'}</Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.dividerLine} />
        </View>

        {/* Guest mode — use the app without an account */}
        <TouchableOpacity
          style={[s.guestBtn, guestLoading && { opacity:.5 }]}
          onPress={continueAsGuest} disabled={guestLoading} activeOpacity={.8}
        >
          <Text style={s.guestBtnText}>
            {guestLoading ? 'Starting…' : 'Continue as guest →'}
          </Text>
        </TouchableOpacity>
        <Text style={s.guestHint}>No account needed. Sign in later to save chats & top up.</Text>

        <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginTop:20 }}>
          <Text style={s.hint}>No account?</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://app.lanwealth.com/auth/signup')} activeOpacity={.7}>
            <Text style={[s.hint, { color:'#1AEBA8', fontWeight:'600' }]}>Sign up free →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container:   { flexGrow:1, backgroundColor:C.bg, alignItems:'center', justifyContent:'center', padding:24 },
  logoWrap:    { alignItems:'center', marginBottom:36 },
  logoImgWrap: { width:72, height:72, borderRadius:18, backgroundColor:'rgba(255,255,255,0.92)', alignItems:'center', justifyContent:'center', marginBottom:14, padding:7 },
  logoImg:     { width:58, height:58 },
  logoTextRow: { flexDirection:'row', alignItems:'baseline', gap:8, marginBottom:4 },
  logoText:    { fontSize:26, fontWeight:'700', color:C.text, letterSpacing:.5 },
  logoZh:      { fontSize:14, color:'rgba(255,255,255,0.3)', letterSpacing:.6 },
  logoSub:     { fontSize:13, color:C.muted, marginTop:2 },
  card:        { width:'100%', maxWidth:360, backgroundColor:C.bg2, borderWidth:1, borderColor:C.border, borderRadius:14, padding:24 },
  label:       { fontSize:12, color:C.muted, marginBottom:6 },
  input:       { backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, padding:12, color:C.text, fontSize:15 },
  eyeBtn:      { position:'absolute', right:12, top:10 },
  errBox:      { marginTop:12, backgroundColor:'rgba(232,69,60,.1)', borderWidth:1, borderColor:'rgba(232,69,60,.3)', borderRadius:6, padding:10 },
  errText:     { color:C.red, fontSize:13 },
  btn:         { marginTop:18, backgroundColor:C.teal, borderRadius:8, padding:13, alignItems:'center' },
  btnText:     { color:'#050505', fontWeight:'700', fontSize:15 },
  hint:        { marginTop:20, fontSize:12, color:C.muted },
  forgotLink:  { fontSize:12, color:C.teal, opacity:.85 },

  dividerRow:  { flexDirection:'row', alignItems:'center', gap:10, width:'100%', maxWidth:360, marginTop:22 },
  dividerLine: { flex:1, height:1, backgroundColor:C.border },
  dividerText: { fontSize:12, color:C.muted },
  guestBtn:    { marginTop:16, width:'100%', maxWidth:360, backgroundColor:'transparent', borderWidth:1, borderColor:C.border2, borderRadius:8, padding:13, alignItems:'center' },
  guestBtnText:{ color:C.text, fontWeight:'600', fontSize:15 },
  guestHint:   { marginTop:8, fontSize:11, color:C.muted, textAlign:'center', maxWidth:340 },
})
