import { createClient }      from '@supabase/supabase-js'
import * as SecureStore      from 'expo-secure-store'
import AsyncStorage          from '@react-native-async-storage/async-storage'
import { Platform }          from 'react-native'

const SUPABASE_URL      = 'https://umpwmtciqxthmyzpymhu.supabase.co'
const SUPABASE_ANON_KEY = 'REPLACE_WITH_SUPABASE_ANON_KEY'   // from Supabase dashboard

// Use SecureStore on native, AsyncStorage on web
const ExpoSecureStoreAdapter = {
  getItem:    (key: string) => Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key),
  setItem:    (key: string, value: string) => Platform.OS === 'web' ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key),
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
