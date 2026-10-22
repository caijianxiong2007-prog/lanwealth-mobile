import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
createRequire(import.meta.url)('./patch-router-query-string.cjs').patchInstalledRouter()
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo
const version = config.version
const buildNumber = config.ios.buildNumber
if (config.ios.bundleIdentifier !== 'cn.lanwealth.baize') throw new Error('Wrong app identity')
const dir = process.env.BAYZE_IOS_OUTPUT || `/Users/jianxiongcai/.codex/tmp/bayze-cn-ios-${version}-${buildNumber}-20261021`
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
const keychain = path.join(dir, 'signing.keychain-db')
const automatic = process.argv.includes('--automatic')
const password = crypto.randomBytes(24).toString('hex')
const original = spawnSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' })
const previous = [...original.stdout.matchAll(/"([^"]+)"/g)].map(m => m[1])
const credentialsFile = process.env.BAYZE_IOS_CREDENTIALS || path.join(root, 'credentials.json')
const credentials = automatic ? null : JSON.parse(fs.readFileSync(credentialsFile, 'utf8')).ios
if (!automatic) fs.chmodSync(credentialsFile, 0o600)
function credentialPath(value) {
  const local = path.resolve(root, value)
  if (fs.existsSync(local)) return local
  const backup = path.resolve(path.dirname(credentialsFile), 'signing-download', value.replace(/^credentials\//, ''))
  if (fs.existsSync(backup)) return backup
  throw new Error('Signing material unavailable: ' + path.basename(value))
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.status !== 0) {
    throw new Error(`${cmd} failed (${result.status}): ${(result.stderr || '').replaceAll(password, '[REDACTED]').slice(-2500)}`)
  }
  return result.stdout || ''
}

try {
  const uuids = {}
  let signingCertificate
  if (!automatic) {
    run('security', ['create-keychain', '-p', password, keychain])
    run('security', ['set-keychain-settings', '-lut', '21600', keychain])
    run('security', ['unlock-keychain', '-p', password, keychain])
    const dist = credentials.Bayze.distributionCertificate
    const certificatePem = run('openssl', ['pkcs12', '-in', credentialPath(dist.path), '-clcerts', '-nokeys', '-passin', 'stdin'], { input: dist.password + '\n' })
    const certificate = new crypto.X509Certificate(certificatePem)
    if (new Date(certificate.validTo) <= new Date()) throw new Error('Distribution certificate has expired')
    signingCertificate = certificate.fingerprint.replaceAll(':', '')
    run('security', ['import', credentialPath(dist.path), '-k', keychain, '-P', dist.password, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'])
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])
    run('security', ['list-keychains', '-d', 'user', '-s', ...previous, keychain])
    console.log(run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]))
    for (const [name, credential] of Object.entries(credentials)) {
      const xml = run('security', ['cms', '-D', '-i', credentialPath(credential.provisioningProfilePath)])
      const uuid = xml.match(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
      if (!uuid) throw new Error(`Missing profile UUID: ${name}`)
      uuids[name] = uuid
      fs.writeFileSync(path.join(dir, `${name}-profile.plist`), xml, { mode: 0o600 })
      const dest = path.join(process.env.HOME, 'Library/Developer/Xcode/UserData/Provisioning Profiles', `${uuid}.mobileprovision`)
      fs.copyFileSync(credentialPath(credential.provisioningProfilePath), dest)
    }
    console.log('Provisioning profile IDs:', JSON.stringify(uuids))
  }
  fs.copyFileSync(path.join(root, 'assets/icon.png'), path.join(root, 'ios/Bayze/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png'))
  if (!process.argv.includes('--export-only')) {
    const log = fs.openSync(path.join(dir, 'archive.log'), 'w')
    console.log(`Archiving ${version} build ${buildNumber}; log:`, path.join(dir, 'archive.log'))
    const build = spawnSync('xcodebuild', ['-workspace', 'ios/Bayze.xcworkspace', '-scheme', 'Bayze', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', path.join(dir, 'Bayze.xcarchive'), '-jobs', '2', '-quiet', 'archive', 'IPHONEOS_DEPLOYMENT_TARGET=15.1', `CURRENT_PROJECT_VERSION=${buildNumber}`, `MARKETING_VERSION=${version}`], { cwd: root, stdio: ['ignore', log, log] })
    fs.closeSync(log)
    if (build.status !== 0) throw new Error(`Archive failed (${build.status}); inspect archive.log`)
    console.log('ARCHIVE SUCCEEDED')
  }
  const options = path.join(dir, 'ExportOptions.plist')
  const signing = automatic ? { signingStyle: 'automatic' } : { signingStyle: 'manual', signingCertificate, provisioningProfiles: { 'cn.lanwealth.baize': uuids.Bayze, 'cn.lanwealth.baize.share-extension': uuids.BayzeShare } }
  fs.writeFileSync(options, JSON.stringify({ method: 'app-store-connect', teamID: '2473SV2X9M', ...signing, stripSwiftSymbols: true, manageAppVersionAndBuildNumber: false }), { mode: 0o600 })
  run('plutil', ['-convert', 'xml1', options])
  const exportLog = fs.openSync(path.join(dir, 'export.log'), 'w')
  console.log('Exporting App Store package')
  const exported = spawnSync('xcodebuild', ['-exportArchive', '-archivePath', path.join(dir, 'Bayze.xcarchive'), '-exportPath', path.join(dir, 'export'), '-exportOptionsPlist', options, ...(automatic ? ['-allowProvisioningUpdates'] : [])], { cwd: root, stdio: ['ignore', exportLog, exportLog] })
  fs.closeSync(exportLog)
  if (exported.status !== 0) throw new Error(`Export failed (${exported.status}); inspect export.log`)
  console.log('EXPORT SUCCEEDED:', path.join(dir, 'export'))
} finally {
  if (!automatic) {
    run('security', ['list-keychains', '-d', 'user', '-s', ...previous])
    spawnSync('security', ['delete-keychain', keychain], { encoding: 'utf8' })
  }
}
