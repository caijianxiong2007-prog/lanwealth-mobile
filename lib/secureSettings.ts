import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export function getSecret(key: string) {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key)
  return SecureStore.getItemAsync(key)
}

export function setSecret(key: string, value: string) {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value)
  return SecureStore.setItemAsync(key, value)
}

export function removeSecret(key: string) {
  if (Platform.OS === 'web') return AsyncStorage.removeItem(key)
  return SecureStore.deleteItemAsync(key)
}
