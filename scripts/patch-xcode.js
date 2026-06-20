const fs = require('fs')

const target = require.resolve('xcode/lib/pbxProject.js')
const source = fs.readFileSync(target, 'utf8')
const original = 'if (project.pbxGroupByName(group).path)'
const patched = 'if (project.pbxGroupByName(group) && project.pbxGroupByName(group).path)'

if (source.includes(patched)) {
  console.log('xcode share-extension compatibility patch already applied')
} else if (source.includes(original)) {
  fs.writeFileSync(target, source.replace(original, patched))
  console.log('applied xcode share-extension compatibility patch')
} else {
  throw new Error('Unsupported xcode package: expected patch location was not found')
}
