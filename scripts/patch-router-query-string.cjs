const fs = require('node:fs')
const path = require('node:path')

const original = 'const queryString = __importStar(require("query-string"));'
const replacement = 'const queryStringModule = require("query-string");\nconst queryString = queryStringModule.default ?? queryStringModule;'

function patchSource(source) {
  if (source.includes(replacement)) return source
  if (!source.includes(original)) throw new Error('Unsupported Expo Router query-string import')
  return source.replace(original, replacement)
}

function patchInstalledRouter() {
  const root = path.dirname(require.resolve('expo-router/package.json'))
  // Router 5's CommonJS fork expects named exports; query-string 9 uses a default export.
  for (const name of ['getPathFromState.js', 'getPathFromState-forks.js']) {
    const target = path.join(root, 'build', 'fork', name)
    const source = fs.readFileSync(target, 'utf8')
    const patched = patchSource(source)
    if (patched !== source) fs.writeFileSync(target, patched)
  }
}

module.exports = { patchSource, patchInstalledRouter }
if (require.main === module) patchInstalledRouter()
