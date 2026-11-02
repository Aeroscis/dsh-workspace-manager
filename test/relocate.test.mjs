/**
 * Relocation core, exercised without a live DSH host.
 *
 * `lib/relocate.js` is the promote orchestration ported from
 * @aeroscis/dsh-temptask and adapted to any formal workspace. Three layers are
 * pure or filesystem-only and therefore testable here:
 *   1. name/occupancy/path validation (the "never guess which layer" rules);
 *   2. moveDirectory/rollbackMove over real temp directories (rename, the
 *      rollback half-state guarantee);
 *   3. the fork-seed builder (completed-prefix boundary) that decides whether
 *      a conversation carries over.
 * The full orchestration needs workspaceRegistry/agents, covered by manual
 * smoke against the running GUI.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSeed,
  isInsideRoot,
  moveDirectory,
  occupied,
  pathsEqual,
  rollbackMove,
  validateName,
} from '../lib/relocate.js'

// ------------------------------------------------------------- validateName
if (process.platform === 'win32') {
  assert.equal(validateName('new-name'), undefined)
  assert.equal(validateName(' con'), '「con」是 Windows 保留名')
  // 'a:b' resolves to basename 'b' on win32, so the separator check fires first;
  // use a character that stays a single basename segment to reach the char list.
  assert.equal(validateName('a:b'), '目录名只能是单段路径，不能含路径分隔符')
  assert.equal(validateName('a<b'), '目录名含 Windows 不允许的字符（< > : " | ? *）')
  assert.equal(validateName('a\\b'), '目录名只能是单段路径，不能含路径分隔符')
  // The name is trimmed first, so trailing spaces never reach the check;
  // trailing dots do.
  assert.equal(validateName('sp '), undefined)
  assert.equal(validateName('dot.'), '目录名不能以空格或点结尾（Windows 会静默去掉它们）')
}
assert.equal(validateName(''), '目录名不能为空')
assert.equal(validateName('..'), '目录名不能是 . 或 ..')

// ------------------------------------------------------- pathsEqual / inside
assert.equal(pathsEqual('D:\\a\\b', 'D:\\a\\b'), true)
assert.equal(isInsideRoot('D:\\root', 'D:\\root\\inner'), true)
assert.equal(isInsideRoot('D:\\root', 'D:\\root2'), false)
assert.equal(isInsideRoot('D:\\root', 'D:\\root'), false)

// ------------------------------------------------------------------ occupied
const base = await mkdtemp(join(tmpdir(), 'wsm-relocate-'))
try {
  const source = join(base, 'proj')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'hello.txt'), 'hi', 'utf8')

  assert.equal(occupied(source), true)
  assert.equal(occupied(join(base, 'missing')), false)

  // ------------------------------------------------------- moveDirectory
  const target = join(base, 'renamed')
  assert.equal(await moveDirectory(source, target), 'rename')
  await assert.rejects(stat(source), (error) => error.code === 'ENOENT')
  await assert.doesNotReject(stat(join(target, 'hello.txt')))

  // ------------------------------------------------------ rollbackMove
  // A create-record failure mid-orchestration must not leave the folder
  // displaced: rollback puts it back byte-for-byte.
  const displaced = join(base, 'moved-again')
  await moveDirectory(target, displaced)
  assert.equal(await rollbackMove(target, displaced), true)
  await assert.doesNotReject(stat(join(target, 'hello.txt')))
  await assert.rejects(stat(displaced), (error) => error.code === 'ENOENT')
} finally {
  await rm(base, { recursive: true, force: true })
}

// ------------------------------------------------------------- buildSeed
// No completed turn → no seed → the caller degrades to a plain session.
assert.equal(buildSeed([]), undefined)
assert.equal(buildSeed(undefined), undefined)
assert.equal(buildSeed([{ type: 'user/message', seq: 0 }]), undefined)

// A completed prefix carries everything up to the boundary plus the marker.
const events = [
  { type: 'session/start', seq: 0 },
  { type: 'turn/start', seq: 1 },
  { type: 'user/message', seq: 2 },
  { type: 'turn/end', seq: 3 },
  // Trailing bookkeeping that belongs to the completed turn, not a new one:
  { type: 'session/title', seq: 4 },
  { type: 'turn/start', seq: 5 },
  { type: 'user/message', seq: 6 },
]
const seed = buildSeed(events)
assert.ok(seed)
assert.equal(seed.inheritedEventCount, 5)
assert.deepEqual(seed.seed.map((event) => event.type), [
  'session/start',
  'turn/start',
  'user/message',
  'turn/end',
  'session/title',
  'session/end-seed',
])
assert.deepEqual(seed.seed.at(-1).data, { inherited: true })

// A new user message after the boundary does not leak into the seed prefix.
const events2 = [
  { type: 'turn/start', seq: 0 },
  { type: 'turn/end', seq: 1 },
  { type: 'user/message', seq: 2, surfaceOp: 'append' },
]
const seed2 = buildSeed(events2)
assert.ok(seed2, 'the completed turn still carries')
assert.equal(seed2.inheritedEventCount, 2, 'the pending user message stays out of the prefix')

// Broken seq numbering fails the seed check rather than corrupting history.
assert.equal(
  buildSeed([
    { type: 'turn/start', seq: 0 },
    { type: 'turn/end', seq: 2 },
  ]),
  undefined,
)

console.log('relocate core: ok')
