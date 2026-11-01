/**
 * Shared test plumbing for `client.js`.
 *
 * The browser half is not importable from Node: it registers itself through
 * `window.__ModuleLoader__.load` and reads `require('react')`. The pure helpers
 * are nevertheless plain functions, so the tests slice the helper block out of
 * the bundle by its boundary comments and evaluate it in an empty VM context.
 *
 * Slicing by marker keeps the tests honest — no copy of the logic lives here —
 * and a moved or renamed helper fails loudly instead of silently testing a stale
 * duplicate. When a block boundary changes, update the marker in the test that
 * broke; that failure is the canary working as intended.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

export const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))

export function readClient() {
  return fs.readFileSync(CLIENT_PATH, 'utf8')
}

/**
 * Evaluate the source between two markers and return the requested top-level
 * bindings. `endMarker` is searched forward from the start marker.
 */
export function loadHelpers(startMarker, endMarker, names) {
  const source = readClient()
  const start = source.indexOf(startMarker)
  assert.ok(start > 0, `helper block start not found in client.js: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.ok(end > start, `helper block end not found in client.js: ${endMarker}`)
  assert.ok(names.length > 0, 'loadHelpers needs at least one binding name')
  const sandbox = {}
  vm.runInNewContext(
    `${source.slice(start, end)}\nthis.__exports = { ${names.join(', ')} }`,
    sandbox,
  )
  const exported = sandbox.__exports
  for (const name of names) {
    assert.ok(exported[name] !== undefined, `helper binding missing: ${name}`)
  }
  return exported
}
