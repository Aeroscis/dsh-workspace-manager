/**
 * Activity semantics: a workspace is "active" only because a human prompt
 * landed in one of its Sessions. Opening a Session, a blank placeholder and a
 * subagent child must never raise a workspace; a fork counts once prompted in.
 */
import assert from 'node:assert/strict'
import { loadHelpers } from './client-helpers.mjs'

const { sessionActivity, activityOf, activeWorkspaceId } = loadHelpers(
  '    function sessionActivity',
  '// ----------------------------------------------------------------- icons',
  ['sessionActivity', 'activityOf', 'activeWorkspaceId'],
)

const byId = {
  a1: { id: 'a1', updatedAt: 100, blank: false },
  a2: { id: 'a2', updatedAt: 150, blank: false },
  aBlank: { id: 'aBlank', updatedAt: 900, blank: true },
  bChild: { id: 'bChild', updatedAt: 950, parentSessionId: 'b1', origin: 'subagent', blank: false },
  b1: { id: 'b1', updatedAt: 200, blank: false },
  bFork: { id: 'bFork', updatedAt: 250, blank: false, parentSessionId: 'b1' },
  c1: { id: 'c1', updatedAt: 300, blank: false },
}
const items = [
  { workspaceId: 'A', sessionIds: ['a1', 'a2', 'aBlank'] },
  { workspaceId: 'B', sessionIds: ['b1', 'bChild', 'bFork'] },
  { workspaceId: 'C', sessionIds: ['c1'] },
  { workspaceId: 'D', sessionIds: [] },
]

assert.equal(sessionActivity(byId.aBlank), 0, 'blank sessions are not activity')
assert.equal(sessionActivity(byId.bChild), 0, 'subagent children are not activity')
assert.equal(sessionActivity(byId.bFork), 250, 'forks are normal sessions')
assert.equal(sessionActivity(undefined), 0)
assert.equal(activityOf(items[0], byId), 150)
assert.equal(activeWorkspaceId(items, byId), 'C')

// Only open workspace A: no prompt timestamps change, so the active workspace
// stays C and an auto-rise pass would not move anything.
const order = ['C', 'B', 'A', 'D']
const step = (current) => {
  const activeId = activeWorkspaceId(items, byId)
  if (activeId === undefined) return current
  const isRunning = () => false
  const boundary = current.find((id) => id !== activeId && !isRunning(id))
  if (boundary === undefined) return current
  if (current.indexOf(activeId) < current.indexOf(boundary)) return current
  const desired = current.filter((id) => id !== activeId)
  desired.splice(desired.indexOf(boundary), 0, activeId)
  return desired
}
assert.deepEqual(step(order), order, 'opening a workspace does not move it')

// A prompt in B (updatedAt advances) raises B above the first idle workspace.
byId.b1.updatedAt = 1000
assert.equal(activeWorkspaceId(items, byId), 'B')
assert.deepEqual(step(order), ['B', 'C', 'A', 'D'])

// A prompt in D raises D to the top of the idle section.
byId.d1 = { id: 'd1', updatedAt: 2000, blank: false }
items[3].sessionIds.push('d1')
assert.equal(activeWorkspaceId(items, byId), 'D')
assert.deepEqual(step(['B', 'C', 'A', 'D']), ['D', 'B', 'C', 'A'])

console.log('activity semantics: ok')
