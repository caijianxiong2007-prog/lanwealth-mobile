// 大陆版根布局(cn 分支):会话守卫换 cnApi(手机号 OTP 令牌),去掉 Supabase 监听与游客模式。
import { useEffect, useState } from 'react'
import { Stack }                       from 'expo-router'
import { StatusBar }                   from 'expo-status-bar'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'
import { useRouter, useSegments }      from 'expo-router'
import { getCnSession }                from '../lib/cnApi'

export default function RootLayout() {
  const router   = useRouter()
  const segments = useSegments()
  const inAuth   = segments[0] === '(auth)'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const session = await getCnSession()
      if (!mounted) return
      setReady(true)
      if (session && inAuth) router.replace('/(tabs)')
      else if (!session && !inAuth) router.replace('/(auth)/login')
    })()
    return () => { mounted = false }
  }, [router, inAuth])

  if (!ready) return null

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  )
}
