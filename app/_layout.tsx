import { useEffect, useRef, useState } from 'react'
import { Stack }                       from 'expo-router'
import { StatusBar }                   from 'expo-status-bar'
import { getSession, signInAsGuest, supabase } from '../lib/supabase'
import { useRouter, useSegments }      from 'expo-router'

export default function RootLayout() {
  const router     = useRouter()
  const segments   = useSegments()
  const inAuth     = segments[0] === '(auth)'
  const [ready, setReady] = useState(false)
  const guestTried = useRef(false)

  useEffect(() => {
    let mounted = true

    async function boot() {
      const session = await getSession()
      if (!mounted) return

      // Already signed in with a real account → go to app.
      // Anonymous guest sessions are allowed to open auth screens so Settings
      // can show native Sign in / Create account flows instead of bouncing back
      // to Chat.
      if (session) {
        setReady(true)
        if (inAuth && !session.user.is_anonymous) router.replace('/(tabs)')
        return
      }

      // No session, and we're NOT on the login screen → silently start a guest
      // session so the app opens straight into chat (no forced registration).
      if (!inAuth && !guestTried.current) {
        guestTried.current = true
        try {
          await signInAsGuest()            // onAuthStateChange routes to (tabs)
          if (mounted) setReady(true)
          return
        } catch {
          // Anonymous sign-ins disabled / rate-limited → fall back to manual login
          if (mounted) { setReady(true); router.replace('/(auth)/login') }
          return
        }
      }

      setReady(true)
    }

    boot()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // When a real account session appears while we're on the auth screen,
      // enter the app. Keep anonymous guest sessions on auth screens.
      // We intentionally do NOT bounce to login on sign-out — boot()/Settings
      // re-establish a guest session instead, so users never hit a login wall.
      if (session && inAuth && !session.user.is_anonymous) router.replace('/(tabs)')
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [router, inAuth])

  if (!ready) return null

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  )
}
