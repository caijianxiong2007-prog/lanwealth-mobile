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
  if (contents.includes("target.name == 'fmt'")) return contents

  const reactNativePostInstall = /(\s+react_native_post_install\([^\n]+\)\n)/
  if (reactNativePostInstall.test(contents)) {
    return contents.replace(reactNativePostInstall, `$1${PATCH}`)
  }

  const postInstall = /(post_install do \|installer\|\n)/
  if (postInstall.test(contents)) {
    return contents.replace(postInstall, `$1${PATCH}`)
  }

  return `${contents}

post_install do |installer|
${PATCH}
end
`
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
