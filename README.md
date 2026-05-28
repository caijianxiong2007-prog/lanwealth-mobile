# LanWealth AI — Mobile

Expo / React Native app for iOS and Android.

## Setup

1. `npm install`
2. Edit `lib/supabase.ts` — replace `REPLACE_WITH_SUPABASE_ANON_KEY` with your key from:  
   https://supabase.com/dashboard/project/umpwmtciqxthmyzpymhu/settings/api-keys

## Run

```bash
npm start        # Expo DevTools
npm run ios      # iOS Simulator
npm run android  # Android Emulator
```

## Build (EAS)

```bash
npm install -g eas-cli && eas login
eas build --platform ios
eas build --platform android
```
