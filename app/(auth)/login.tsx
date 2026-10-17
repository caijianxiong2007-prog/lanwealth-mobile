// 大陆版登录页(cn 分支):手机号+验证码,登注合一(与网页端同款流程)
// 后端 = cn-chat /api otp_send / otp_verify;成功后 session_token 存 SecureStore。
// P0-02(2026-10-15):发送验证码前须勾选同意隐私政策与用户协议(未默认勾选),
// 同意版本随 OTP 请求上送,服务端写入 account_consents 留痕。
import { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { cnOtpSend, cnOtpVerify } from '../../lib/cnApi'
import { normalizePhone, isCnMobile } from '../../lib/cnPhone'

const PRIVACY_VERSION = '2026-10-v1'

const C = {
  bg: '#0a0f0d', card: '#101815', border: '#22302a', text: '#e6efe9', muted: '#8fa89b',
  teal: '#1aeba8', red: '#e05656',
}

export default function LoginScreen() {
  const router     = useRouter()
  const [phone, setPhone]     = useState('')
  const [code, setCode]       = useState('')
  const [sent, setSent]       = useState(false)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError]     = useState('')
  const [countdown, setCountdown] = useState(0)
  const [agreed, setAgreed]   = useState(false)   // 未默认勾选
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    const p = normalizePhone(phone)
    if (!agreed) { setError('请先阅读并勾选同意《隐私政策》与《用户协议》'); return }
    if (!isCnMobile(p)) { setError('请输入正确的 11 位手机号'); return }
    setError(''); setSending(true)
    const r = await cnOtpSend(p, { version: PRIVACY_VERSION, channel: 'app' })
    setSending(false)
    if (r.ok) { setSent(true); startCountdown() } else setError(r.error || '发送失败')
  }

  async function verify() {
    const p = normalizePhone(phone)
    if (code.trim().length !== 6) { setError('请输入 6 位验证码'); return }
    setError(''); setVerifying(true)
    const r = await cnOtpVerify(p, code.trim(), true)   // remember=true:30 天免登
    setVerifying(false)
    if (r.ok) router.replace('/(tabs)')
    else setError(r.error || '验证失败')
  }

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.card}>
        <Image source={require('../../assets/bayze-logo.png')} style={s.logo} />
        <Text style={s.title}>白泽 Bayze · 大陆版</Text>
        <Text style={s.sub}>手机号验证即登录,未注册自动创建。{'\n'}数据存储于境内,对话走已备案国产大模型。</Text>

        <TextInput
          style={s.input}
          placeholder="11 位手机号"
          placeholderTextColor={C.muted}
          keyboardType="phone-pad"
          maxLength={11}
          value={phone}
          onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
        />
        {sent && (
          <View style={s.codeRow}>
            <TextInput
              style={[s.input, { flex: 1, marginBottom: 0 }]}
              placeholder="6 位验证码"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            />
            <TouchableOpacity style={s.resend} disabled={countdown > 0} onPress={sendCode}>
              <Text style={[s.resendTx, countdown > 0 && { color: C.muted }]}>
                {countdown > 0 ? `${countdown}s` : '重新发送'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity style={s.demoBtn} onPress={() => router.push('/(auth)/demo')} accessibilityRole="button" activeOpacity={0.8}>
          <Text style={s.demoTx}>无需登录，体验演示</Text>
        </TouchableOpacity>

        {error ? <Text style={s.err}>{error}</Text> : null}

        {/* P0-02:协议同意(未默认勾选;不同意不得发码) */}
        <View style={s.agreeRow}>
          <TouchableOpacity style={s.agreeBox} onPress={() => setAgreed((v) => !v)} activeOpacity={0.7} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
            <Text style={[s.agreeTick, !agreed && { opacity: 0 }]}>✓</Text>
          </TouchableOpacity>
          <Text style={s.agreeTx}>
            已阅读并同意
            <Text style={s.agreeLink} onPress={() => Linking.openURL('https://app.lanwealth.cn/privacy')}>《隐私政策》</Text>
            与
            <Text style={s.agreeLink} onPress={() => Linking.openURL('https://app.lanwealth.cn/terms')}>《用户协议》</Text>
          </Text>
        </View>

        {!sent ? (
          <TouchableOpacity style={s.btn} onPress={sendCode} disabled={sending} activeOpacity={0.8}>
            {sending ? <ActivityIndicator color="#04140e" /> : <Text style={s.btnTx}>获取验证码</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.btn} onPress={verify} disabled={verifying} activeOpacity={0.8}>
            {verifying ? <ActivityIndicator color="#04140e" /> : <Text style={s.btnTx}>验证并开始</Text>}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 24 },
  logo: { width: 76, height: 76, borderRadius: 18, alignSelf: 'center', marginTop: 4 },
  title: { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  sub: { color: C.muted, fontSize: 12.5, textAlign: 'center', marginTop: 6, marginBottom: 18, lineHeight: 18 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, fontSize: 15, padding: 12, marginBottom: 12 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  resend: { padding: 10 },
  resendTx: { color: C.teal, fontSize: 13 },
  err: { color: C.red, fontSize: 12.5, marginBottom: 8 },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, marginTop: 2 },
  agreeBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: C.teal, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginTop: 1 },
  agreeTick: { color: C.teal, fontSize: 12, fontWeight: '700' },
  agreeTx: { color: C.muted, fontSize: 12, lineHeight: 17, flex: 1 },
  agreeLink: { color: C.teal },
  btn: { backgroundColor: C.teal, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 4 },
  btnTx: { color: '#04140e', fontSize: 15, fontWeight: '700' },
  demoBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  demoTx: { color: C.teal, fontSize: 14 },
})
