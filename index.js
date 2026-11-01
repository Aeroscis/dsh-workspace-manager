/**
 * Host half — intentionally empty.
 *
 * The package is a browser-only plugin: `dsh.bundle.patch` inserts this row so
 * the Loader owns the package lifecycle, and `dsh.client` ships `client.js` to
 * the Web GUI. Nothing model-facing is registered here.
 */
export function apply() {}
