import fs from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const source = fs.readFileSync('client.js', 'utf8')
const start = source.indexOf('    function restTops')
const end = source.indexOf('    // ----------------------------------------------------------------- icons', start)
assert.ok(start > 0 && end > start, 'drag helper block not found')
const block = source.slice(start, end)
const sandbox = {}
vm.runInNewContext(
  `${block}\nthis.restTops=restTops; this.moveInOrder=moveInOrder; this.dropIndexFor=dropIndexFor; this.previewOffsets=previewOffsets`,
  sandbox,
)
const { restTops, moveInOrder, dropIndexFor, previewOffsets } = sandbox
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
