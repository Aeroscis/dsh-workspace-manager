/**
 * Release-shape gate. Runs offline: no registry access, no network, no build.
 *
 * `npm pack --dry-run` (see `npm run check`) proves what would ship; this script
 * proves the things packing cannot see — that the published metadata is
 * complete, that every path named in the manifest exists, that the bundle still
 * registers under the published package name, and that the changelog documents
 * the version being released. A missing licence file or a scoped package without
 * `publishConfig.access: public` fails here rather than at `npm publish`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const checks = []

function check(label, fn) {
  try {
    const detail = fn()
    checks.push({ ok: true, label, detail })
  } catch (error) {
    checks.push({ ok: false, label, detail: error instanceof Error ? error.message : String(error) })
    failures.push(`${label}: ${checks.at(-1).detail}`)
  }
}

const fail = (message) => {
  throw new Error(message)
}

const read = (relative) => {
  const full = path.join(root, relative)
  if (!fs.existsSync(full)) fail(`missing file: ${relative}`)
  return fs.readFileSync(full, 'utf8')
}

const required = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') fail(`package.json is missing ${label}`)
  return value
}

/** Expand a `files` entry that may use one `*` segment, e.g. `locale/*.json`. */
function expandGlob(entry) {
  if (!entry.includes('*')) return fs.existsSync(path.join(root, entry)) ? [entry] : []
  const star = entry.indexOf('*')
  const dir = entry.slice(0, star).replace(/\/$/, '')
  const suffix = entry.slice(star + 1)
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return []
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith(suffix))
    .map((name) => `${dir}/${name}`)
}

const pkg = JSON.parse(read('package.json'))

check('name is the published scoped name', () => {
  const name = required(pkg.name, 'name')
  if (name !== '@aeroscis/dsh-workspace-manager') fail(`unexpected name: ${name}`)
  return name
})

check('version is semver', () => {
  const version = required(pkg.version, 'version')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`not semver: ${version}`)
  return version
})

check('scoped package publishes publicly', () => {
  if (pkg.publishConfig?.access !== 'public') {
    fail('publishConfig.access must be "public" for a scoped package')
  }
  return 'publishConfig.access = public'
})

for (const [label, value] of [
  ['license', pkg.license],
  ['author', pkg.author],
  ['description', pkg.description],
  ['repository.url', pkg.repository?.url],
  ['homepage', pkg.homepage],
  ['bugs.url', pkg.bugs?.url],
]) {
  check(`${label} is declared`, () => required(value, label))
}

check('engines declare the verified host', () => {
  const node = required(pkg.engines?.node, 'engines.node')
  const dsh = required(pkg.engines?.dsh, 'engines.dsh')

  // 断言的是语义而不是写法：前缀匹配（startsWith('^0.2.1')）会因为改成分段范围
  // （`^0.2.1-0 || ^0.2.2-0`）之外的任何等价写法而误报，也拦不住「范围里混进了大版本」。
  // 这里直接验两件事：受支持的 0.2.x 预发布版落在范围内，下一个大版本被拒。
  let semver
  try {
    // 本仓库没有依赖，semver 从宿主或 profile 借；借不到就跳过语法检查（不假装通过）。
    semver = createRequire(path.join(process.env.DSH_PROFILE_DIR ?? '', 'package.json'))('semver')
  } catch {
    semver = undefined
  }
  if (semver === undefined) return `node ${node} · dsh ${dsh}（无 semver，未校验范围语义）`

  const includePrerelease = { includePrerelease: true }
  for (const supported of ['0.2.1-rc.2', '0.2.2-rc.3', '0.2.3']) {
    if (!semver.satisfies(supported, dsh, includePrerelease)) {
      fail(`engines.dsh ${dsh} 不覆盖 ${supported}，宿主会拒绝装载本插件`)
    }
  }
  if (semver.satisfies('0.3.0-rc.1', dsh, includePrerelease)) {
    fail(`engines.dsh ${dsh} 覆盖了 0.3.0-rc.1；跨大版本必须先人工验证再放行`)
  }
  return `node ${node} · dsh ${dsh}（覆盖 0.2.x，拒绝 0.3）`
})

check('LICENSE matches the declared licence', () => {
  const text = read('LICENSE')
  if (!text.startsWith('MIT License')) fail('LICENSE does not start with "MIT License"')
  if (!/Copyright \(c\) \d{4}/.test(text)) fail('LICENSE has no copyright line')
  return 'MIT'
})

check('CHANGELOG documents the released version', () => {
  const text = read('CHANGELOG.md')
  const heading = `## [${pkg.version}]`
  const hits = text.split('\n').filter((line) => line.startsWith(heading)).length
  if (hits === 0) fail(`CHANGELOG.md has no "${heading}" section`)
  if (hits > 1) fail(`CHANGELOG.md has ${hits} "${heading}" sections`)
  return heading
})

check('bundle patch points at this package', () => {
  const text = read(pkg.dsh?.bundle?.patch ?? 'cordis.patch.yml')
  if (!text.includes(`'${pkg.name}'`) && !text.includes(`"${pkg.name}"`)) {
    fail(`cordis.patch.yml does not reference ${pkg.name}`)
  }
  return pkg.dsh.bundle.patch
})

check('client bundle registers under the package name', () => {
  const entry = pkg.exports?.['./client']
  if (!entry) fail('exports["./client"] is missing')
  const source = read(entry)
  if (!source.includes('window.__ModuleLoader__.load')) fail(`${entry} does not call __ModuleLoader__.load`)
  if (!source.includes(`id: '${pkg.name}'`)) fail(`${entry} is not registered as ${pkg.name}`)
  return entry
})

check('every manifest path exists', () => {
  const missing = []
  for (const entry of pkg.files ?? []) {
    if (expandGlob(entry).length === 0) missing.push(entry)
  }
  for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    if (target.includes('*')) continue
    if (!fs.existsSync(path.join(root, target))) missing.push(`exports["${key}"] -> ${target}`)
  }
  if (missing.length) fail(`missing paths: ${missing.join(', ')}`)
  return `${(pkg.files ?? []).length} files entries`
})

check('locale dictionaries parse', () => {
  const files = expandGlob('locale/*.json')
  if (files.length < 2) fail('expected locale/*.json dictionaries')
  for (const file of files) {
    const dict = JSON.parse(read(file))
    if (!dict.meta?.title || !dict.meta?.description) fail(`${file} is missing meta.title/meta.description`)
  }
  return files.join(', ')
})

check('README ships and points at the changelog', () => {
  const text = read('README.md')
  if (!text.includes('CHANGELOG.md')) fail('README.md does not link CHANGELOG.md')
  return 'ok'
})

for (const entry of checks) {
  console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.label} — ${entry.detail}`)
}
if (failures.length) {
  console.error(`\nrelease check failed (${failures.length}):\n${failures.map((line) => `  - ${line}`).join('\n')}`)
  process.exit(1)
}
console.log(`\nrelease shape: ok (${checks.length} checks)`)
