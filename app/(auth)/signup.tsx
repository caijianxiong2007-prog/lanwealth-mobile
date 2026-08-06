import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
         KeyboardAvoidingView, Platform, Image } from 'react-native'
import { useRouter }         from 'expo-router'
import { supabase }          from '../../lib/supabase'
import { getCachedConfig, refreshConfig } from '../../lib/appConfig'
import PhoneAuth from '../../components/PhoneAuth'

const C = { bg:'#0A0A0B', bg2:'#111113', bg3:'#18181C', border:'#222228', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', teal:'#1AEBA8', teal2:'#0F8C63', teal3:'#083D2B', red:'#E8453C' }

export default function SignupScreen() {
  const router = useRouter()
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw,  setShowPw]  = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [notice,  setNotice]  = useState('')
  // 手机号注册:入口开关由服务端 /api/app-config 下发(与登录页同一开关)
  const [phoneEnabled, setPhoneEnabled] = useState(false)
  const [mode, setMode] = useState<'email' | 'phone'>('email')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const cached = await getCachedConfig()
      if (alive) setPhoneEnabled(cached.phoneAuth)
      const fresh = await refreshConfig()
      if (alive && fresh) setPhoneEnabled(fresh.phoneAuth)
    })()
    return () => { alive = false }
  }, [])

  async function signUp() {
    if (!email || !pass) return
    if (pass.length < 6)   { setError('Password must be at least 6 characters.'); return }
    if (pass !== confirm)  { setError('Passwords do not match.'); return }
    setLoading(true); setError(''); setNotice('')
    const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password: pass })
    setLoading(false)
    if (err) { setError(err.message); return }
    // Email confirmation OFF → session is returned and RootLayout routes to (tabs).
    // If confirmation is ON, no session → tell the user to check their inbox.
    if (data.session) {
      router.replace('/(tabs)')
    } else {
      setNotice('Account created. Please check your email to confirm, then sign in.')
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex:1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">

        {/* Bayze logo */}
        <View style={s.logoWrap}>
          <View style={s.logoImgWrap}>
            <Image source={require('../../assets/bayze-logo.png')} style={s.logoImg} resizeMode="contain" />
          </View>
          <View style={s.logoTextRow}>
            <Text style={s.logoText}>Bayze</Text>
            <Text style={s.logoZh}>白泽</Text>
          </View>
          <Text style={s.logoSub}>Create a free account</Text>
        </View>

        {/* Card */}
        <View style={s.card}>

          {/* 邮箱 / 手机号 切换。手机号走验证码**登注合一**,与登录页是同一个组件 */}
          {phoneEnabled ? (
            <View style={s.tabRow}>
              {(['email', 'phone'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[s.tab, mode === m && s.tabOn]}
                  onPress={() => { setMode(m); setError(''); setNotice('') }}
                  activeOpacity={.7}
                >
                  <Text style={[s.tabText, mode === m && s.tabTextOn]}>
                    {m === 'email' ? '邮箱 Email' : '手机号 Phone'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {mode === 'phone' ? (
            <PhoneAuth onDone={() => router.replace('/(tabs)')} />
          ) : (
          <>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input} value={email} onChangeText={setEmail}
            autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
            placeholderTextColor={C.muted} placeholder="your@email.com"
          />

          <Text style={[s.label, { marginTop:14 }]}>Password</Text>
          <View>
            <TextInput
              style={[s.input, { paddingRight: 44 }]}
              value={pass} onChangeText={setPass}
              secureTextEntry={!showPw}
              placeholderTextColor={C.muted} placeholder="At least 6 characters"
            />
            <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw(v => !v)} activeOpacity={.7}>
              <Text style={{ fontSize:18 }}>{showPw ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[s.label, { marginTop:14 }]}>Confirm password</Text>
          <TextInput
            style={s.input} value={confirm} onChangeText={setConfirm}
            secureTextEntry={!showPw}
            placeholderTextColor={C.muted} placeholder="••••••••"
          />

          {error ? (
            <View style={s.errBox}><Text style={s.errText}>{error}</Text></View>
          ) : null}
          {notice ? (
            <View style={s.noticeBox}><Text style={s.noticeText}>{notice}</Text></View>
          ) : null}

          <TouchableOpacity
            style={[s.btn, loading && { opacity:.5 }]}
            onPress={signUp} disabled={loading} activeOpacity={.8}
          >
            <Text style={s.btnText}>{loading ? 'Creating…' : 'Create account →'}</Text>
          </TouchableOpacity>
          </>
          )}
        </View>

        <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginTop:20 }}>
          <Text style={s.hint}>Already have an account?</Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/login')} activeOpacity={.7}>
            <Text style={[s.hint, { color:C.teal, fontWeight:'600' }]}>Sign in →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  tabRow:      { flexDirection:'row', gap:8, marginBottom:18 },
  tab:         { flex:1, paddingVertical:9, borderRadius:8, borderWidth:1, borderColor:C.border2, alignItems:'center', backgroundColor:'transparent' },
  tabOn:       { borderColor:C.teal, backgroundColor:C.teal3 },
  tabText:     { fontSize:13, color:C.muted, fontWeight:'600' },
  tabTextOn:   { color:C.teal },
  container:   { flexGrow:1, backgroundColor:C.bg, alignItems:'center', justifyContent:'center', padding:24 },
  logoWrap:    { alignItems:'center', marginBottom:32 },
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
  noticeBox:   { marginTop:12, backgroundColor:'rgba(26,235,168,.08)', borderWidth:1, borderColor:'rgba(26,235,168,.3)', borderRadius:6, padding:10 },
  noticeText:  { color:C.teal, fontSize:13 },
  btn:         { marginTop:18, backgroundColor:C.teal, borderRadius:8, padding:13, alignItems:'center' },
  btnText:     { color:'#050505', fontWeight:'700', fontSize:15 },
  hint:        { fontSize:12, color:C.muted },
})
