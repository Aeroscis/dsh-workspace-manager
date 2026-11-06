/**
 * Host actions: open a workspace directory in the desktop file manager.
 *
 * Everything is exercised with a fake Context — the real `sessionController`
 * only exists inside a running DSH, and the interesting behaviour is the
 * optional-service degradation plus the "signal is mandatory" contract of
 * `openWorkspacePath`.
 */
import assert from 'node:assert/strict'
import { canOpenPath, openPathInFileManager, openWorkspaceDirectory } from '../lib/actions.js'

function fakeCtx({ controller, workspace } = {}) {
  return {
    get(name) {
      if (name === 'sessionController') return controller
      if (name === 'workspaceRegistry') {
        if (workspace === undefined) return undefined
        return { get: (id) => (id === workspace.id ? workspace : undefined) }
      }
      return undefined
    },
  }
}

// ---------------------------------------------------------------- capability
assert.equal(canOpenPath(fakeCtx()), false, 'no sessionController → cannot open')
assert.equal(canOpenPath(fakeCtx({ controller: {} })), false, 'missing method → cannot open')
assert.equal(
  canOpenPath({
    get: () => ({
      canOpenWorkspacePath() {
        throw new Error('boom')
      },
    }),
  }),
  false,
  'a throwing probe is "cannot open", not a crash',
)
assert.equal(canOpenPath(fakeCtx({ controller: { canOpenWorkspacePath: () => true } })), true)
assert.equal(canOpenPath(fakeCtx({ controller: { canOpenWorkspacePath: () => false } })), false)

// ------------------------------------------------------------- open a path
assert.deepEqual(await openPathInFileManager(fakeCtx(), '   '), { opened: false, message: '路径为空' })
assert.equal((await openPathInFileManager(fakeCtx(), 'D:/proj')).opened, false, 'no controller → not opened')

{
  const calls = []
  const ctx = fakeCtx({
    controller: {
      async openWorkspacePath(request, signal) {
        calls.push({ request, hasSignal: signal !== undefined && typeof signal.throwIfAborted === 'function' })
        return { opened: true }
      },
    },
  })
  assert.deepEqual(await openPathInFileManager(ctx, ' D:/proj '), { opened: true })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].request, { path: 'D:/proj' }, 'path is trimmed before use')
  assert.equal(calls[0].hasSignal, true, 'the real implementation calls signal.throwIfAborted()')
}

{
  const ctx = fakeCtx({
    controller: {
      async openWorkspacePath() {
        return { opened: false }
      },
    },
  })
  const result = await openPathInFileManager(ctx, 'D:/proj')
  assert.equal(result.opened, false)
  assert.match(result.message, /没有打开/)
}

{
  const ctx = fakeCtx({
    controller: {
      async openWorkspacePath() {
        throw new Error('no desktop')
      },
    },
  })
  assert.deepEqual(await openPathInFileManager(ctx, 'D:/proj'), { opened: false, message: 'no desktop' })
}

// -------------------------------------------------------- open by workspace
assert.equal((await openWorkspaceDirectory(fakeCtx(), '  ')).code, 'badRequest')
assert.equal((await openWorkspaceDirectory(fakeCtx(), 'w1')).code, 'fs', 'no registry → fs error')
assert.equal((await openWorkspaceDirectory(fakeCtx({ workspace: { id: 'w1', path: '/p' } }), 'w2')).code, 'notFound')

{
  const opened = []
  const ctx = fakeCtx({
    workspace: { id: 'w1', path: 'D:/projects/app' },
    controller: {
      async openWorkspacePath(request) {
        opened.push(request.path)
        return { opened: true }
      },
    },
  })
  assert.deepEqual(await openWorkspaceDirectory(ctx, 'w1'), {
    ok: true,
    opened: true,
    path: 'D:/projects/app',
  })
  assert.deepEqual(opened, ['D:/projects/app'], 'the path comes from the registry, never from the client')
}

{
  const ctx = fakeCtx({
    workspace: { id: 'w1', path: 'D:/projects/app' },
    controller: {
      async openWorkspacePath() {
        throw new Error('desktop unavailable')
      },
    },
  })
  assert.deepEqual(await openWorkspaceDirectory(ctx, 'w1'), {
    ok: false,
    code: 'fs',
    message: 'desktop unavailable',
  })
}

console.log('host actions: ok')
