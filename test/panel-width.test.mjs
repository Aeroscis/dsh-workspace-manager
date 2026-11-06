/**
 * Panel width math: the default (content-based) width, the drag clamp and the
 * viewport ceiling. Pure functions sliced out of client.js by their marker.
 */
import assert from 'node:assert/strict'
import { loadHelpers } from './client-helpers.mjs'

const {
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  ROW_CHROME_WIDTH,
  clampPanelWidth,
  preferredPanelWidth,
} = loadHelpers(
  '// ---------------------------------------------------------- panel width',
  '// The popover hangs off the launcher',
  ['PANEL_MIN_WIDTH', 'PANEL_MAX_WIDTH', 'ROW_CHROME_WIDTH', 'clampPanelWidth', 'preferredPanelWidth'],
)

assert.equal(PANEL_MIN_WIDTH, 300)
assert.equal(PANEL_MAX_WIDTH, 760)
assert.equal(ROW_CHROME_WIDTH > 0, true)

// ------------------------------------------------------------------- clamp
assert.equal(clampPanelWidth(undefined, 1024), PANEL_MIN_WIDTH, 'no stored width → minimum')
assert.equal(clampPanelWidth(Number.NaN, 1024), PANEL_MIN_WIDTH)
assert.equal(clampPanelWidth(500, 1024), 500, 'a stored width is honoured')
assert.equal(clampPanelWidth(200, 1024), PANEL_MIN_WIDTH, 'below the floor → floor')
assert.equal(clampPanelWidth(5000, 1024), PANEL_MAX_WIDTH, 'above the cap → cap')
assert.equal(clampPanelWidth(5000, 500), 476, 'narrow window wins over the cap (viewport - 24)')
assert.equal(clampPanelWidth(900, 700), 676, 'the cap and the viewport both apply')
assert.equal(clampPanelWidth(0, 0), PANEL_MIN_WIDTH, 'unknown viewport falls back to a sane default')
assert.equal(clampPanelWidth(432.6, 1024), 433, 'widths are rounded')

// --------------------------------------------------------- content default
assert.equal(preferredPanelWidth(160, 1440), 160 + ROW_CHROME_WIDTH)
assert.equal(preferredPanelWidth(0, 1440), PANEL_MIN_WIDTH, 'short names never go below the floor')
assert.equal(preferredPanelWidth(9999, 1440), PANEL_MAX_WIDTH, 'a very long name stops at the cap')
assert.equal(preferredPanelWidth(9999, 700), 676, 'and at the viewport on a small screen')
assert.equal(preferredPanelWidth(undefined, 1440), PANEL_MIN_WIDTH)

console.log('panel width: ok')
