import { useState, useEffect, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { resolveBase } from '../lib/baseUrl'

// ── 手机号验证码 登录/注册(2026-08-06)──────────────────────────────────────
//
// 与网页端 src/components/auth/PhoneAuthForm.tsx **同一套流程**,不要各写一套:
//   ① 手机号规范化成 E.164(11 位国内号补 +86)
//   ② supabase.auth.signInWithOtp({ phone, shouldCreateUser: true }) —— **登注合一**,
//      没注册过的号码发码即注册,所以登录页和注册页用的是同一个组件
//   ③ supabase.auth.verifyOtp({ phone, token, type: 'sms' })
//   ④ 验证成功后打 /api/account/sync,把 auth.users.phone 同步进 public.users.phone
//
// ⚠️ 两条网络路径不一样,别混:
//   · 发码/验码走 **Supabase 直连域**(*.supabase.co)—— 不受大陆 SNI 阻断影响,
//     所以登录本身不经 baseUrl 的多域名切换层。
//   · account/sync 走**我们自己的域**(可能被阻断)—— 必须用 resolveBase() 取当前可用域。
//     它失败不该挡住登录:会话已经建立,同步是补充动作,静默失败即可。

const C = { bg3:'#18181C', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', teal:'#1AEBA8', red:'#E8453C' }

/** 手机号规范化为 E.164:已带 + 用原值;11 位国内号补 +86;其余去空格原样。 */
function normalize(raw: string): string {
  const t = raw.trim().replace(/[\s-]/g, '')
  if (t.startsWith('+')) return t
  if (/^1\d{10}$/.test(t)) return `+86${t}`
  if (/^86\d{11}$/.test(t)) return `+${t}`
  return t
}

export default function PhoneAuth({ onDone, remember = true }: { onDone?: () => void; remember?: boolean }) {
  const [phone, setPhone]         = useState('')
  const [otp, setOtp]             = useState('')
  const [sent, setSent]           = useState(false)
  const [sending, setSending]     = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError]         = useState('')
  const [msg, setMsg]             = useState('')
  const [cooldown, setCooldown]   = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // 记住账号:预填上次用过的手机号(只记标识,不存任何凭据)
  useEffect(() => {
    (async () => {
      try {
        if ((await AsyncStorage.getItem('lw_remember')) === '0') return
        const p = await AsyncStorage.getItem('lw_acct_phone')
        if (p) setPhone(p)
      } catch { /* ignore */ }
    })()
  }, [])

  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  function startCooldown() {
    setCooldown(60)
    timer.current = setInterval(() => setCooldown(c => {
      if (c <= 1 && timer.current) { clearInterval(timer.current); return 0 }
      return c - 1
    }), 1000)
  }

  async function sendCode() {
    const p = normalize(phone)
    if (!/^\+\d{8,15}$/.test(p)) { setError('请输入有效手机号 / Enter a valid phone number'); return }
    setSending(true); setError(''); setMsg('')
    const { error: err } = await supabase.auth.signInWithOtp({ phone: p, options: { shouldCreateUser: true } })
    setSending(false)
    if (err) { setError(err.message); return }
    setSent(true)
    setMsg('验证码已发送,请查收短信 / Code sent')
    startCooldown()
  }

  async function verify() {
    const p = normalize(phone)
    setVerifying(true); setError('')
    const { error: err } = await supabase.auth.verifyOtp({ phone: p, token: otp.trim(), type: 'sms' })
    if (err) { setVerifying(false); setError(err.message); return }

    // 会话已建立。以下都是补充动作,任何一步失败都不该把用户挡在门外。
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        const base = await resolveBase()
        await fetch(`${base}/api/account/sync`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      }
    } catch { /* 静默:同步失败不影响已登录状态 */ }

    try {
      await AsyncStorage.setItem('lw_remember', remember ? '1' : '0')
      if (remember) await AsyncStorage.setItem('lw_acct_phone', p)
      else await AsyncStorage.removeItem('lw_acct_phone')
      await AsyncStorage.setItem('lw_acct_method', 'phone')
    } catch { /* ignore */ }

    setVerifying(false)
    onDone?.()   // 未传时不做跳转:RootLayout 的 auth 监听会自行路由
  }

  return (
    <View>
      <Text style={s.label}>手机号 / Phone</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={C.muted}
          placeholder="11 位手机号,或 +区号"
        />
        <TouchableOpacity
          style={[s.codeBtn, (sending || cooldown > 0) && { opacity: .5 }]}
          onPress={sendCode}
          disabled={sending || cooldown > 0}
          activeOpacity={.7}
        >
          <Text style={s.codeBtnText}>
            {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s` : (sent ? '重新发送' : '发送验证码')}
          </Text>
        </TouchableOpacity>
      </View>

      {sent ? (
        <>
          <Text style={[s.label, { marginTop: 14 }]}>验证码 / Code</Text>
          <TextInput
            style={s.input}
            value={otp}
            onChangeText={t => setOtp(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            placeholderTextColor={C.muted}
            placeholder="6 位验证码"
          />
        </>
      ) : null}

      {msg   ? <Text style={s.okText}>{msg}</Text> : null}
      {error ? <View style={s.errBox}><Text style={s.errText}>{error}</Text></View> : null}

      {sent ? (
        <TouchableOpacity
          style={[s.btn, (verifying || otp.length < 4) && { opacity: .5 }]}
          onPress={verify}
          disabled={verifying || otp.length < 4}
          activeOpacity={.8}
        >
          <Text style={s.btnText}>{verifying ? '验证中…' : '登录 / 注册 →'}</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={s.hint}>没有账号会自动注册 · New numbers are registered automatically</Text>
    </View>
  )
}

const s = StyleSheet.create({
  label:       { fontSize:12, color:C.muted, marginBottom:6 },
  input:       { backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, padding:12, color:C.text, fontSize:15 },
  codeBtn:     { justifyContent:'center', paddingHorizontal:14, backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8 },
  codeBtnText: { color:C.teal, fontSize:13, fontWeight:'600' },
  okText:      { color:C.teal, fontSize:13, marginTop:10 },
  errBox:      { marginTop:12, backgroundColor:'rgba(232,69,60,.1)', borderWidth:1, borderColor:'rgba(232,69,60,.3)', borderRadius:6, padding:10 },
  errText:     { color:C.red, fontSize:13 },
  btn:         { marginTop:18, backgroundColor:C.teal, borderRadius:8, padding:13, alignItems:'center' },
  btnText:     { color:'#050505', fontWeight:'700', fontSize:15 },
  hint:        { marginTop:12, fontSize:11, color:C.muted, textAlign:'center' },
})
