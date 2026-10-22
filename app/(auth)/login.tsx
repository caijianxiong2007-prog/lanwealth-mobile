// 大陆版登录页(cn 分支):验证码登注合一,或已有账号的正常密码登录。
// 后端 = cn-chat /api otp_send / otp_verify;成功后 session_token 存 SecureStore。
// P0-02(2026-10-15):发送验证码前须勾选同意隐私政策与用户协议(未默认勾选),
// 同意版本随 OTP 请求上送,服务端写入 account_consents 留痕。
import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Linking, ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cnOtpSend, cnOtpVerify, cnPasswordLogin } from '../../lib/cnApi'
import { normalizePhone, isCnMobile } from '../../lib/cnPhone'

const PRIVACY_VERSION = '2026-10-v1'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', red: '#e05656',
}

export default function LoginScreen() {
  const router     = useRouter()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<'sms' | 'password'>('sms')
  const [phone, setPhone]     = useState('')
  const [code, setCode]       = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent]       = useState(false)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError]     = useState('')
  const [countdown, setCountdown] = useState(0)
  const [agreed, setAgreed]   = useState(false)   // 未默认勾选
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const busyRef = useRef(false)
  const busy = sending || verifying

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  function resetCode() {
    if (timerRef.current) clearInterval(timerRef.current)
    setCountdown(0); setCode(''); setSent(false)
  }

  function changeMode(next: 'sms' | 'password') {
    if (busyRef.current || mode === next) return
    resetCode(); setPassword(''); setError(''); setMode(next)
  }

  function changePhone(value: string) {
    if (busyRef.current) return
    resetCode(); setPassword(''); setError(''); setPhone(value.replace(/\D/g, ''))
  }

  function startCountdown() {
    setCountdown(60)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  async function sendCode() {
    if (busyRef.current) return
    const p = normalizePhone(phone)
    if (!agreed) { setError('请先阅读并勾选同意《隐私政策》与《用户协议》'); return }
    if (!isCnMobile(p)) { setError('请输入正确的 11 位手机号'); return }
    busyRef.current = true
    setError(''); setSending(true)
    try {
      const r = await cnOtpSend(p, { version: PRIVACY_VERSION, channel: 'app' })
      if (r.ok) { setSent(true); startCountdown() } else setError(r.error || '发送失败')
    } finally { setSending(false); busyRef.current = false }
  }

  async function verify() {
    if (busyRef.current) return
    const p = normalizePhone(phone)
    if (!agreed) { setError('请先阅读并勾选同意《隐私政策》与《用户协议》'); return }
    if (!isCnMobile(p)) { setError('请输入正确的 11 位手机号'); return }
    if (mode === 'sms' && !/^\d{6}$/.test(code.trim())) { setError('请输入 6 位验证码'); return }
    if (mode === 'password' && !password) { setError('请输入登录密码'); return }
    busyRef.current = true
    setError(''); setVerifying(true)
    try {
      const r = mode === 'password'
        ? await cnPasswordLogin(p, password)
        : await cnOtpVerify(p, code.trim(), true)
      if (r.ok) { setPassword(''); router.replace('/(tabs)') }
      else setError(r.error || '登录失败')
    } finally { setVerifying(false); busyRef.current = false }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.wrap, { paddingTop: Math.max(24, insets.top), paddingBottom: Math.max(24, insets.bottom) }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={s.card}>
        <Image source={require('../../assets/bayze-logo.png')} style={s.logo} />
        <Text style={s.title}>白泽 Bayze · 大陆版</Text>
        <Text style={s.sub}>{mode === 'sms' ? '手机号验证即登录，未注册自动创建。' : '使用已注册手机号与已设置的密码登录。'}{'\n'}数据存储于境内，对话使用中国模型。</Text>

        <View style={s.modes} accessibilityRole="tablist">
          {(['sms', 'password'] as const).map(item => <TouchableOpacity key={item} accessibilityRole="tab" accessibilityState={{ selected: mode === item, disabled: busy }} disabled={busy} onPress={() => changeMode(item)} style={[s.mode, mode === item && s.modeSelected]}>
            <Text style={[s.modeTx, mode === item && s.modeSelectedTx]}>{item === 'sms' ? '验证码登录' : '密码登录'}</Text>
          </TouchableOpacity>)}
        </View>

        <TextInput
          style={s.input}
          placeholder="11 位手机号"
          placeholderTextColor={C.muted}
          keyboardType="phone-pad"
          maxLength={11}
          value={phone}
          editable={!busy}
          accessibilityLabel="手机号"
          onChangeText={changePhone}
        />
        {mode === 'password' && <TextInput
          style={s.input} placeholder="登录密码" placeholderTextColor={C.muted}
          value={password} onChangeText={setPassword} secureTextEntry editable={!busy}
          autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password"
          accessibilityLabel="登录密码" returnKeyType="go" onSubmitEditing={verify}
        />}
        {mode === 'sms' && sent && (
          <View style={s.codeRow}>
            <TextInput
              style={[s.input, { flex: 1, marginBottom: 0 }]}
              placeholder="6 位验证码"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              editable={!busy}
              textContentType="oneTimeCode"
              accessibilityLabel="短信验证码"
              onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            />
            <TouchableOpacity style={s.resend} disabled={countdown > 0 || busy} onPress={sendCode}>
              <Text style={[s.resendTx, countdown > 0 && { color: C.muted }]}>
                {countdown > 0 ? `${countdown}s` : '重新发送'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {error ? <Text style={s.err} accessibilityRole="alert">{error}</Text> : null}

        {/* P0-02:协议同意(未默认勾选;不同意不得发码) */}
        <View style={s.agreeRow}>
          <TouchableOpacity style={s.agreeTarget} disabled={busy} onPress={() => setAgreed((v) => !v)} activeOpacity={0.7} accessibilityRole="checkbox" accessibilityLabel="同意隐私政策与用户协议" accessibilityState={{ checked: agreed }}>
            <View style={s.agreeBox}><Text style={[s.agreeTick, !agreed && { opacity: 0 }]}>✓</Text></View>
          </TouchableOpacity>
          <Text style={s.agreeTx}>
            已阅读并同意
            <Text style={s.agreeLink} onPress={() => Linking.openURL('https://app.lanwealth.cn/privacy')}>《隐私政策》</Text>
            与
            <Text style={s.agreeLink} onPress={() => Linking.openURL('https://app.lanwealth.cn/terms')}>《用户协议》</Text>
          </Text>
        </View>

        {mode === 'sms' && !sent ? (
          <TouchableOpacity style={s.btn} onPress={sendCode} disabled={busy} accessibilityRole="button" activeOpacity={0.8}>
            {sending ? <ActivityIndicator color="#04140e" /> : <Text style={s.btnTx}>获取验证码</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.btn} onPress={verify} disabled={busy} accessibilityRole="button" activeOpacity={0.8}>
            {verifying ? <ActivityIndicator color="#04140e" /> : <Text style={s.btnTx}>{mode === 'password' ? '登录' : '验证并开始'}</Text>}
          </TouchableOpacity>
        )}
        {mode === 'password' && <Text style={s.help}>尚未设置或忘记密码？可切换验证码登录，在网页版个人中心的安全设置中设置密码。</Text>}
        <TouchableOpacity style={s.demoBtn} disabled={busy} onPress={() => router.push('/(auth)/demo')} accessibilityRole="button" activeOpacity={0.8}>
          <Text style={s.demoTx}>无需登录，体验演示</Text>
        </TouchableOpacity>
        <Text style={s.demoNote}>仅展示预置示例，完整在线功能请登录。</Text>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 24 },
  logo: { width: 76, height: 76, borderRadius: 18, alignSelf: 'center', marginTop: 4 },
  title: { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  sub: { color: C.muted, fontSize: 12.5, textAlign: 'center', marginTop: 6, marginBottom: 18, lineHeight: 18 },
  modes: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 18 },
  mode: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  modeSelected: { borderBottomColor: C.teal },
  modeTx: { color: C.muted, fontSize: 14 },
  modeSelectedTx: { color: C.teal, fontWeight: '600' },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, fontSize: 15, padding: 12, marginBottom: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  resend: { padding: 10 },
  resendTx: { color: C.teal, fontSize: 13 },
  err: { color: C.red, fontSize: 12.5, marginBottom: 8 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 2 },
  agreeTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  agreeBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  agreeTick: { color: C.teal, fontSize: 12, fontWeight: '700' },
  agreeTx: { color: C.muted, fontSize: 12, lineHeight: 17, flex: 1 },
  agreeLink: { color: C.teal },
  btn: { backgroundColor: C.teal, minHeight: 48, borderRadius: 10, padding: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnTx: { color: '#04140e', fontSize: 15, fontWeight: '700' },
  demoBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  demoTx: { color: C.teal, fontSize: 14 },
  demoNote: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  help: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 12 },
})
