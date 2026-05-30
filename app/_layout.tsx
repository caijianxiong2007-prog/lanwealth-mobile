import { useEffect, useState }  from 'react'
import { Stack }                 from 'expo-router'
import { StatusBar }             from 'expo-status-bar'
import { getSession, supabase }  from '../lib/supabase'
import { useRouter, useSegments } from 'expo-router'

export default function RootLayout() {
  const router   = useRouter()
  const segments = useSegments()
  const inAuth   = segments[0] === '(auth)'
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const syncRoute = (session: unknown) => {
      if (!session && !inAuth) router.replace('/(auth)/login')
      if (session  &&  inAuth) router.replace('/(tabs)')
    }

    getSession().then(session => {
      setReady(true)
      syncRoute(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncRoute(session)
    })
    return () => subscription.unsubscribe()
  }, [router, inAuth])

  if (!ready) return null

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  )
}
