const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const PATCH = `
      # Xcode 26 workaround: React Native's vendored fmt can fail C++20 consteval checks.
      # Keep this scoped to the fmt pod so the rest of React Native can keep its defaults.
      installer.pods_project.targets.each do |target|
        if target.name == 'fmt'
          target.build_configurations.each do |config|
            config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
          end
        end
      end
`

function injectFmtPatch(contents) {
  const clean = contents.replace(PATCH, '')
  if (clean.includes("target.name == 'fmt'")) throw new Error('Unrecognized fmt patch; inspect the Podfile before changing it')
  const reactNativePostInstall = /(^[ \t]*react_native_post_install\([^\n]*\)\n|^[ \t]*react_native_post_install\([\s\S]*?^[ \t]*\)[ \t]*\n)/m
  if (!reactNativePostInstall.test(clean)) throw new Error('Missing React Native post-install hook')
  return clean.replace(reactNativePostInstall, `$1${PATCH}`)
}

module.exports = function withFmtCxx17(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfile = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile')
      if (fs.existsSync(podfile)) {
        const contents = fs.readFileSync(podfile, 'utf8')
        fs.writeFileSync(podfile, injectFmtPatch(contents))
      }
      return modConfig
    },
  ])
}

module.exports.injectFmtPatch = injectFmtPatch
