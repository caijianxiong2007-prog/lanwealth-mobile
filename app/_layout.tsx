import { useEffect, useState }  from 'react'
import { Stack }                 from 'expo-router'
import { StatusBar }             from 'expo-status-bar'
import { getSession, supabase }  from '../lib/supabase'
import { useRouter, useSegments } from 'expo-router'

export default function RootLayout() {
  const router   = useRouter()
  const segments = useSegments()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    getSession().then(session => {
      setReady(true)
      const inAuth = segments[0] === '(auth)'
      if (!session && !inAuth) router.replace('/(auth)/login')
      if (session  &&  inAuth) router.replace('/(tabs)/')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const inAuth = segments[0] === '(auth)'
      if (!session && !inAuth) router.replace('/(auth)/login')
      if (session  &&  inAuth) router.replace('/(tabs)/')
    })
    return () => subscription.unsubscribe()
  }, [])

  if (!ready) return null

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  )
}
