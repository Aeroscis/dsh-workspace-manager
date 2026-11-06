/**
 * Sidebar actions that need the Host.
 *
 * Only one action lives here: opening a Workspace's directory in the desktop
 * file manager. Rename is deliberately absent — DSH already registers
 * `workspace.rename` (and `workspace.delete`) in the sidebar row menu, with its
 * own duplicate-title check, so a second dialog only risks diverging from it.
 *
 * The opener is the official `sessionController.openWorkspacePath`: it accepts
 * an arbitrary Host path (not a workspace id) and is a no-op on hosts without a
 * desktop. Both ends are optional, so a host missing the service degrades to
 * "this host cannot open folders" rather than throwing.
 */
import { messageOf } from './relocate.js';

/** 宿主桌面能不能打开文件夹；UI 据此决定是否渲染那个按钮。 */
export function canOpenPath(ctx) {
    const controller = ctx.get('sessionController');
    if (controller === undefined || typeof controller.canOpenWorkspacePath !== 'function')
        return false;
    try {
        return controller.canOpenWorkspacePath() === true;
    }
    catch {
        return false;
    }
}

/**
 * 在宿主的文件管理器里打开一个目录。
 *
 * `openWorkspacePath` 的真实实现会立刻 `signal.throwIfAborted()`，所以第二个
 * 参数不能省（少传就是 "Cannot read properties of undefined"）；旧版宿主不读它，
 * 多传也无害。`action` 留空 = 按默认程序打开，对目录就是文件管理器。
 */
export async function openPathInFileManager(ctx, path) {
    const target = typeof path === 'string' ? path.trim() : '';
    if (target.length === 0)
        return { opened: false, message: '路径为空' };
    const controller = ctx.get('sessionController');
    if (controller === undefined || typeof controller.openWorkspacePath !== 'function') {
        return { opened: false, message: '当前宿主未提供 openWorkspacePath' };
    }
    try {
        const result = await controller.openWorkspacePath({ path: target }, new AbortController().signal);
        if (result?.opened === true)
            return { opened: true };
        return { opened: false, message: '宿主没有打开这个路径（可能没有桌面环境）' };
    }
    catch (error) {
        return { opened: false, message: messageOf(error) };
    }
}

/** 按 id 打开工作区目录：路径从注册表取，客户端传不了任意路径。 */
export async function openWorkspaceDirectory(ctx, workspaceId) {
    const id = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    if (id.length === 0)
        return { ok: false, code: 'badRequest', message: '缺少 workspaceId' };
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined)
        return { ok: false, code: 'fs', message: '宿主未提供 workspaceRegistry' };
    const workspace = registry.get(id);
    if (workspace === undefined)
        return { ok: false, code: 'notFound', message: '工作区不存在，可能已被移除' };
    const result = await openPathInFileManager(ctx, workspace.path);
    if (result.opened !== true)
        return { ok: false, code: 'fs', message: result.message };
    return { ok: true, opened: true, path: workspace.path };
}
