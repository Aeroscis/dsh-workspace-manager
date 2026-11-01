/**
 * Drag geometry: the pure functions that turn measured row heights plus a
 * pointer delta into a drop index and a set of "make room" offsets.
 */
import assert from 'node:assert/strict'
import { loadHelpers } from './client-helpers.mjs'

const { restTops, moveInOrder, dropIndexFor, previewOffsets } = loadHelpers(
  '    function restTops',
  '// ----------------------------------------------------------------- icons',
  ['restTops', 'moveInOrder', 'dropIndexFor', 'previewOffsets'],
)

const eq = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected))

eq(restTops([30, 30, 30], 0), [0, 30, 60])
eq(moveInOrder(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'])
eq(moveInOrder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
eq(moveInOrder(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c'])

const h = [30, 30, 30]
assert.equal(dropIndexFor(h, 0, 0, 0), 0)
assert.equal(dropIndexFor(h, 0, 0, 16), 0)
assert.equal(dropIndexFor(h, 0, 0, 31), 1)
assert.equal(dropIndexFor(h, 0, 0, 61), 2)
assert.equal(dropIndexFor(h, 0, 2, -31), 1)
assert.equal(dropIndexFor(h, 0, 2, -61), 0)
// The bottom clamp adds 1px so the last slot is reachable despite the tie.
assert.equal(dropIndexFor(h, 0, 0, 60), 1)
assert.equal(dropIndexFor(h, 0, 0, 61), 2)

eq(previewOffsets(h, 0, 0, 0), [0, 0, 0])
eq(previewOffsets(h, 0, 0, 1), [30, -30, 0])
eq(previewOffsets(h, 0, 0, 2), [60, -30, -30])
eq(previewOffsets(h, 0, 2, 0), [30, 30, -60])

const uneven = [20, 40, 30]
assert.equal(dropIndexFor(uneven, 0, 1, 40), 2)
eq(previewOffsets(uneven, 0, 1, 2), [0, 30, -40])

console.log('drag geometry: ok')
