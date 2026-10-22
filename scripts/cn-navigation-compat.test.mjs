import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const {injectFmtPatch} = createRequire(import.meta.url)('../plugins/with-fmt-cxx17.js')
const require = createRequire(import.meta.url)
const {patchSource} = require('./patch-router-query-string.cjs')

test('router query-string import supports modern default and legacy named exports, idempotently', () => {
  const original = 'const queryString = __importStar(require("query-string"));\nexports.queryString = queryString;'
  const patched = patchSource(original)
  assert.equal(patchSource(patched), patched)
  assert.throws(() => patchSource('unexpected upstream source'), /Unsupported/)
  for (const module of [require('query-string'), require('query-string').default]) {
    const ctx = createContext({ exports: {}, require: () => module })
    runInContext(patched, ctx)
    assert.equal(ctx.exports.queryString.stringify({ hello: '白泽', count: 2 }, {sort:false}), 'hello=%E7%99%BD%E6%B3%BD&count=2')
  }
})

test('installed Expo Router serializes tab transitions with params and encoded query values', () => {
  const cache = new Map()
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const filename = require.resolve('expo-router/build/fork/'+name)
    const ctx = createContext({exports:{},process,require: dependency => {
      if (dependency === '@react-navigation/native') return {validatePathConfig: () => {}}
      if (dependency === './getPathFromState-forks') return load('getPathFromState-forks')
      if (dependency === '../matchers') return require('expo-router/build/matchers')
      if (dependency === 'query-string') return require('query-string')
      throw new Error('Unexpected router dependency: '+dependency)
    }})
    // Only the React Native platform boundary is stubbed; both router forks and serializer are real.
    runInContext(patchSource(readFileSync(filename,'utf8')),ctx)
    cache.set(name,ctx.exports)
    return ctx.exports
  }
  const {getPathFromState} = load('getPathFromState')
  const options = {screens:{'(tabs)':{path:'',screens:{index:'',workbench:'workbench',settings:'settings'}}}}
  for (const name of ['index','workbench','settings']) {
    const state = {routes:[{name:'(tabs)',state:{routes:[{name,params:{q:'白泽 & test',zero:0}}]}}]}
    const result = getPathFromState(state,options)
    assert.match(result,/q=%E7%99%BD%E6%B3%BD%20%26%20test/)
    assert.match(result,/zero=0/)
    assert.equal(result.startsWith(name === 'index' ? '/?' : '/'+name+'?'),true)
  }
  assert.equal(load('getPathFromState-forks').appendQueryAndHash('/workbench',{q:'a&b','#':'section'}),'/workbench?q=a%26b#section')
})

test('workbench forms have stable component identity across input changes', () => {
  const source = readFileSync(new URL('../app/(tabs)/workbench.tsx',import.meta.url),'utf8')
  const ast = ts.createSourceFile('workbench.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const card = ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Card')
  const screen = ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='WorkbenchScreen')
  assert.ok(card && screen)
  let nestedCard=false
  function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='Card')nestedCard=true;ts.forEachChild(n,walk)}
  walk(screen)
  assert.equal(nestedCard,false)
})

for (const call of ['  react_native_post_install(installer)\n', '  react_native_post_install(\n    installer,\n    config[:reactNativePath],\n  )\n']) {
  test('fmt compatibility runs after the React Native hook and is idempotent: '+call.trim().split('\n')[0], () => {
    const original = 'post_install do |installer|\n'+call+'end\n'
    const patched = injectFmtPatch(original)
    assert.ok(patched.indexOf("target.name == 'fmt'") > patched.indexOf(call))
    assert.equal(injectFmtPatch(patched),patched)
    const withoutCall = patched.replace(call,'')
    const end = withoutCall.lastIndexOf('end\n')
    const legacy = withoutCall.slice(0,end)+call+withoutCall.slice(end)
    assert.equal(injectFmtPatch(legacy),patched)
  })
}
