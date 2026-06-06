import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView,
         Linking, Image, TextInput, Alert, Platform } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase }  from '../../lib/supabase'
import { getSecret, removeSecret, setSecret } from '../../lib/secureSettings'

const C = { bg:'#0A0A0B', bg2:'#111113', bg3:'#18181C', border:'#222228', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', dim:'#38383F', teal:'#1AEBA8', teal2:'#0F8C63', teal3:'#083D2B', red:'#E8453C' }

export default function SettingsScreen() {
  const router = useRouter()
  const [apiUrl,  setApiUrl]  = useState('')
  const [apiKey,  setApiKey]  = useState('')
  const [saved,   setSaved]   = useState(false)
  const [guest,   setGuest]   = useState(false)
  const [email,   setEmail]   = useState('')
  const showExternalLinks = Platform.OS !== 'ios'

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('custom_api_url'),
      getSecret('custom_api_key'),
    ]).then(([url, key]) => {
      if (url) setApiUrl(url)
      if (key) setApiKey(key)
    })
    supabase.auth.getUser().then(({ data: { user } }) => {
      setGuest(!!user?.is_anonymous)
      setEmail(user?.email ?? '')
    })
  }, [])

  async function saveCustomApi() {
    await AsyncStorage.setItem('custom_api_url', apiUrl.trim())
    await setSecret('custom_api_key', apiKey.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function clearCustomApi() {
    Alert.alert('Clear Custom API', 'Remove custom API settings and use LanWealth API?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('custom_api_url')
        await removeSecret('custom_api_key')
        setApiUrl(''); setApiKey('')
      }},
    ])
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/(auth)/login')
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteAccount },
      ],
    )
  }

  async function deleteAccount() {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { Alert.alert('Error', 'Not signed in.'); return }
    try {
      const res = await fetch('https://app.lanwealth.com/api/account/delete', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(String(res.status))
      await supabase.auth.signOut()
      router.replace('/(auth)/login')
    } catch {
      Alert.alert('Error', 'Could not delete account. Please email support@lanwealth.com.')
    }
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 50 }}>

      {/* Brand header */}
      <View style={s.brandHeader}>
        <View style={s.brandImgWrap}>
          <Image source={require('../../assets/bayze-logo.png')} style={s.brandImg} resizeMode="contain" />
        </View>
        <View>
          <View style={{ flexDirection:'row', alignItems:'baseline', gap:7 }}>
            <Text style={s.brandName}>Bayze</Text>
            <Text style={s.brandZh}>白泽</Text>
          </View>
          <Text style={s.brandSub}>AI Chat · v1.0.0</Text>
        </View>
      </View>

      {showExternalLinks && (
        <>
          {/* Platform links */}
          <Text style={s.section}>Platform</Text>
          <View style={s.card}>
            <TouchableOpacity style={s.row} onPress={() => Linking.openURL('https://app.lanwealth.com/dashboard/billing')} activeOpacity={.7}>
              <Text style={s.rowText}>💳  Top up credits</Text>
              <Text style={{ color:C.teal, fontSize:13 }}>Billing ↗</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.row} onPress={() => Linking.openURL('https://app.lanwealth.com/dashboard')} activeOpacity={.7}>
              <Text style={s.rowText}>🌐  Web Dashboard</Text>
              <Text style={{ color:C.muted, fontSize:13 }}>↗</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.row, { borderBottomWidth:0 }]} onPress={() => Linking.openURL('https://app.lanwealth.com/download')} activeOpacity={.7}>
              <Text style={s.rowText}>💻  Desktop App</Text>
              <Text style={{ color:C.muted, fontSize:13 }}>Download ↗</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Custom API / BYOK */}
      <Text style={s.section}>Custom API (optional)</Text>
      <View style={s.card}>
        <View style={{ padding:14 }}>
          <Text style={s.hint}>Use your own OpenAI-compatible API endpoint (Groq, Together, local Ollama, etc.). Leave blank to use LanWealth credits.</Text>

          <Text style={[s.label, { marginTop:14 }]}>Base URL</Text>
          <TextInput
            style={s.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://api.groq.com/openai/v1"
            placeholderTextColor={C.dim}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[s.label, { marginTop:12 }]}>API Key</Text>
          <TextInput
            style={s.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk-..."
            placeholderTextColor={C.dim}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={{ flexDirection:'row', gap:10, marginTop:14 }}>
            <TouchableOpacity style={[s.btn, { flex:1 }]} onPress={saveCustomApi} activeOpacity={.8}>
              <Text style={s.btnText}>{saved ? '✓ Saved' : 'Save'}</Text>
            </TouchableOpacity>
            {(apiUrl || apiKey) ? (
              <TouchableOpacity style={[s.btn, s.btnDanger, { flex:1 }]} onPress={clearCustomApi} activeOpacity={.8}>
                <Text style={[s.btnText, { color:C.red }]}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <Text style={[s.hint, { marginTop:10, color:'#2a2a35' }]}>
            Free options: Groq (llama3, gemma), Together AI free tier, local Ollama (http://localhost:11434/v1)
          </Text>
        </View>
      </View>

      {/* Account */}
      <Text style={s.section}>Account</Text>
      {guest ? (
        <View style={s.card}>
          <View style={{ padding:14, borderBottomWidth:1, borderBottomColor:C.border }}>
            <Text style={[s.rowText, { fontWeight:'600' }]}>👤  Guest</Text>
            <Text style={[s.hint, { marginTop:6 }]}>
              You're using Bayze as a guest — chats are saved on this device only.
              Sign in if you want to use an account.
            </Text>
          </View>
          <TouchableOpacity style={s.row} onPress={() => router.push('/(auth)/login')} activeOpacity={.7}>
            <Text style={[s.rowText, { color:C.teal }]}>Sign in</Text>
            <Text style={{ color:C.muted, fontSize:13 }}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, { borderBottomWidth:0 }]} onPress={() => router.push('/(auth)/signup' as Href)} activeOpacity={.7}>
            <Text style={s.rowText}>Create a free account</Text>
            <Text style={{ color:C.muted, fontSize:13 }}>→</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.card}>
          {email ? (
            <View style={[s.row, { borderBottomWidth:1, borderBottomColor:C.border }]}>
              <Text style={s.rowText}>📧  {email}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={s.row} onPress={signOut} activeOpacity={.7}>
            <Text style={[s.rowText, { color:C.red }]}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, { borderBottomWidth:0 }]} onPress={confirmDeleteAccount} activeOpacity={.7}>
            <Text style={[s.rowText, { color:C.red }]}>Delete account</Text>
            <Text style={{ color:C.muted, fontSize:12 }}>Permanent</Text>
          </TouchableOpacity>
        </View>
      )}

    </ScrollView>
  )
}

const s = StyleSheet.create({
  container:    { flex:1, backgroundColor:C.bg, padding:20 },
  brandHeader:  { flexDirection:'row', alignItems:'center', gap:14, marginTop:16, marginBottom:28 },
  brandImgWrap: { width:54, height:54, borderRadius:13, backgroundColor:'rgba(255,255,255,0.9)', alignItems:'center', justifyContent:'center', padding:5 },
  brandImg:     { width:44, height:44 },
  brandName:    { fontSize:22, fontWeight:'700', color:C.text, letterSpacing:.4 },
  brandZh:      { fontSize:13, color:'rgba(255,255,255,0.3)', letterSpacing:.5 },
  brandSub:     { fontSize:12, color:C.muted, marginTop:2 },
  section:      { fontSize:11, fontWeight:'600', color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:8, marginTop:20 },
  card:         { backgroundColor:C.bg2, borderRadius:12, borderWidth:1, borderColor:C.border, overflow:'hidden' },
  row:          { flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:14, borderBottomWidth:1, borderBottomColor:C.border },
  rowText:      { fontSize:15, color:C.text },
  hint:         { fontSize:12, color:C.muted, lineHeight:18 },
  label:        { fontSize:11, color:C.muted, marginBottom:6 },
  input:        { backgroundColor:C.bg3, borderWidth:1, borderColor:C.border2, borderRadius:8, padding:11, color:C.text, fontSize:14 },
  btn:          { backgroundColor:C.teal2, borderRadius:8, padding:11, alignItems:'center' },
  btnDanger:    { backgroundColor:'rgba(232,69,60,0.1)', borderWidth:1, borderColor:'rgba(232,69,60,0.3)' },
  btnText:      { color:'#fff', fontWeight:'600', fontSize:14 },
})
