import { createClient }      from '@supabase/supabase-js'
import * as SecureStore      from 'expo-secure-store'
import AsyncStorage          from '@react-native-async-storage/async-storage'
import { Platform }          from 'react-native'

const SUPABASE_URL      = 'https://umpwmtciqxthmyzpymhu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_hIlCsZWUP4TOyWmZ7CuVlA_0GDMNOqZ'

// Use SecureStore on native, localStorage on web (with SSR guard)
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    if (Platform.OS !== 'web') return SecureStore.getItemAsync(key)
    if (typeof window === 'undefined') return Promise.resolve(null)
    return AsyncStorage.getItem(key)
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS !== 'web') return SecureStore.setItemAsync(key, value)
    if (typeof window === 'undefined') return Promise.resolve()
    return AsyncStorage.setItem(key, value)
  },
  removeItem: (key: string) => {
    if (Platform.OS !== 'web') return SecureStore.deleteItemAsync(key)
    if (typeof window === 'undefined') return Promise.resolve()
    return AsyncStorage.removeItem(key)
  },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage:          ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: false,
  },
})

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Guest mode: create an anonymous session so users can chat without registering
// (App Store Guideline 5.1.1(v) — registration may not be required for features
// that are not account-based). Requires "Anonymous sign-ins" enabled in the
// Supabase dashboard. Returns the session, or throws if anonymous auth is off.
export async function signInAsGuest() {
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return data.session
}

export async function isGuest() {
  const { data: { user } } = await supabase.auth.getUser()
  return !!user?.is_anonymous
}