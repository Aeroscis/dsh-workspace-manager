/**
 * The auto-rise invariant, exercised as a fixed-point loop.
 *
 * `step()` in client.js cannot be imported (it closes over `ctx`), so this test
 * mirrors its two passes — the pinned prefix, then the active row placed before
 * the first row that is neither pinned nor running — and asserts the property
 * that actually matters: repeated passes converge instead of oscillating.
 *
 * The oscillation case is the regression this guards: skipping only running rows
 * makes the active row rise above the pin, the pin pass then pushes it back, and
 * the two passes fight forever.
 */
import assert from 'node:assert/strict'

const step = (order, pinned, running, active) => {
  const prefixed = [...pinned, ...order.filter((id) => !pinned.includes(id))]
  if (JSON.stringify(prefixed) !== JSON.stringify(order)) return prefixed
  if (!active || pinned.includes(active)) return order
  const boundary = order.find(
    (id) => id !== active && !pinned.includes(id) && !running.includes(id),
  )
  if (boundary === undefined) return order
  if (order.indexOf(active) < order.indexOf(boundary)) return order
  const desired = order.filter((id) => id !== active)
  desired.splice(desired.indexOf(boundary), 0, active)
  return desired
}

const fixed = (order, pinned, running, active) => {
  let current = order
  for (let i = 0; i < 8; i += 1) {
    const next = step(current, pinned, running, active)
    if (JSON.stringify(next) === JSON.stringify(current)) return current
    current = next
  }
  assert.fail(`did not settle within 8 passes: ${JSON.stringify(current)}`)
}

// Active is already below the pin: no movement, no oscillation.
assert.deepEqual(fixed(['P', 'A', 'I'], ['P'], [], 'A'), ['P', 'A', 'I'])
// Active starts below idle: it rises to just below the pin.
assert.deepEqual(fixed(['P', 'I', 'A'], ['P'], [], 'A'), ['P', 'A', 'I'])
// Running rows stay above the active row.
assert.deepEqual(fixed(['P', 'R', 'I', 'A'], ['P'], ['R'], 'A'), ['P', 'R', 'A', 'I'])
// Without pinned rows the original behavior is unchanged.
assert.deepEqual(fixed(['I', 'A'], [], [], 'A'), ['A', 'I'])
// A pinned active row does not move at all.
assert.deepEqual(fixed(['A', 'I'], ['A'], [], 'A'), ['A', 'I'])
// Everything running or pinned: no boundary, so the order is left alone.
assert.deepEqual(fixed(['P', 'R'], ['P'], ['R'], 'R'), ['P', 'R'])

console.log('sort rule: ok')
