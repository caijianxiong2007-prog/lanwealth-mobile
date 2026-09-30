// Expo Router native-intent handler for expo-share-intent.
//
// When a file/text/image is shared into Bayze (e.g. from WeChat), the iOS share
// extension (and Android intent) opens the app via a deep link like
//   lanwealth:///dataUrl=lanwealthShareKey
// Without this handler, Expo Router treats that URL as a page path and renders the
// "Unmatched Route" (page-not-found) screen. Here we detect the share-intent link and
// redirect to the chat tab, where useShareIntentContext() picks up the shared payload.
import { getShareExtensionKey } from 'expo-share-intent'

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return '/(tabs)'
    }
  } catch {
    // fall through and route normally on any error
  }
  return path
}
