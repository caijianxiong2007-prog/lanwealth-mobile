import { View, Text, TouchableOpacity, StyleSheet, Switch, ScrollView } from 'react-native'
import { supabase }  from '../../lib/supabase'

const C = { bg:'#0A0A0B', bg2:'#111113', bg3:'#18181C', border:'#222228', border2:'#2C2C35', text:'#E4E4EA', muted:'#606070', dim:'#38383F', teal:'#1AEBA8', teal2:'#0F8C63', teal3:'#083D2B' }

const LANGS = [
  { code:'en', label:'English',    flag:'🇬🇧' },
  { code:'zh', label:'中文',        flag:'🇨🇳' },
  { code:'vi', label:'Tiếng Việt', flag:'🇻🇳' },
  { code:'th', label:'ภาษาไทย',    flag:'🇹🇭' },
  { code:'ms', label:'Melayu',     flag:'🇲🇾' },
  { code:'id', label:'Indonesia',  flag:'🇮🇩' },
]

export default function SettingsScreen() {
  async function signOut() { await supabase.auth.signOut() }

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>Settings</Text>

      <Text style={s.sectionTitle}>Language</Text>
      <View style={s.card}>
        {LANGS.map(l => (
          <TouchableOpacity key={l.code} style={s.row} activeOpacity={.7}>
            <Text style={s.rowText}>{l.flag}  {l.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionTitle}>Account</Text>
      <View style={s.card}>
        <TouchableOpacity style={[s.row, { borderBottomWidth: 0 }]} onPress={signOut} activeOpacity={.7}>
          <Text style={[s.rowText, { color:'#E8453C' }]}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>LanWealth AI • v1.0.0</Text>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container:    { flex:1, backgroundColor:C.bg, padding:20 },
  title:        { fontSize:24, fontWeight:'700', color:C.text, marginBottom:24, marginTop:16 },
  sectionTitle: { fontSize:11, fontWeight:'600', color:C.muted, textTransform:'uppercase', letterSpacing:.8, marginBottom:8, marginTop:20 },
  card:         { backgroundColor:C.bg2, borderRadius:10, borderWidth:1, borderColor:C.border, overflow:'hidden' },
  row:          { flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:14, borderBottomWidth:1, borderBottomColor:C.border },
  rowText:      { fontSize:15, color:C.text },
  footer:       { fontSize:12, color:C.dim, textAlign:'center', marginTop:40 },
})
