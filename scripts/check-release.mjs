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
  if (!dsh.startsWith('^0.2.1')) fail(`README documents DSH 0.2.1-rc.3, engines.dsh is ${dsh}`)
  return `node ${node} · dsh ${dsh}`
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
