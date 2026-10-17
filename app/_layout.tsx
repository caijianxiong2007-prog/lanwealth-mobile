// 大陆版根布局(cn 分支):会话守卫换 cnApi(手机号 OTP 令牌),去掉 Supabase 监听与游客模式。
// ShareIntentProvider:系统分享/「用其他应用打开」的深链载体(scheme=baize-cn),聊天页消费。
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack }                       from 'expo-router'
import { StatusBar }                   from 'expo-status-bar'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'
import { ShareIntentProvider }         from 'expo-share-intent'
import { useRouter, useSegments }      from 'expo-router'
import { getCnSession, setCnUnauthorizedHandler } from '../lib/cnApi'
import type { CnSession } from '../lib/cnApi'
import { readStartupSession } from '../lib/cnSessionBootstrap'

export default function RootLayout() {
  const router   = useRouter()
  const segments = useSegments()
  const inAuth   = segments[0] === '(auth)'
  const [checked, setChecked] = useState<{ inAuth: boolean; session: CnSession | null } | null>(null)
  const ready = checked?.inAuth === inAuth
  const session = checked?.session ?? null

  // P1-08:统一 401 跳登——cnApi 层检测到令牌过期/撤销时回调(单飞,多请求只跳一次)
  useEffect(() => {
    setCnUnauthorizedHandler(() => router.replace('/(auth)/login'))
    return () => setCnUnauthorizedHandler(null)
  }, [router])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const session = await readStartupSession(getCnSession)
      if (!mounted) return
      setChecked({ inAuth, session })
    })()
    return () => { mounted = false }
  }, [inAuth])

  // Navigate only after the root Stack has mounted. Failed credential reads never grant access.
  useEffect(() => {
    if (!ready) return
    if (session && inAuth) router.replace('/(tabs)')
    else if (!session && !inAuth) router.replace('/(auth)/login')
  }, [ready, session, inAuth, router])

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ShareIntentProvider options={{ debug: false, resetOnBackground: false, scheme: 'baize-cn' }}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
        {(!ready || (!session && !inAuth)) && <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#0a0f0d', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#1aeba8" accessibilityLabel="正在读取登录状态" /></View>}
      </ShareIntentProvider>
    </SafeAreaProvider>
  )
}
