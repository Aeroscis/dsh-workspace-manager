/**
 * Workspace Manager — host half core: workspace path relocation.
 *
 * 为什么这不是一个「改路径」的调用：DSH 的工作区记录以 **realpath 字符串相等**为唯一性
 * （`@deepseek-ai/dsh-workspace` 的 `src/paths.ts`），注册表只有
 * `create/get/list/delete/resolveByPath/insertBefore`，实体只有 `setTitle/attachSession/...`
 * ——没有任何 setPath/move。所以「把工作区指到另一个目录」只能编排成：
 *
 *   1. 校验落点（名字、父目录、不覆盖、不被别的工作区占用）；
 *   2. 中止该工作区名下活着的会话当轮（best-effort，免得 agent 继续往搬走的目录里写）；
 *   3. （可选）搬目录（`rename`；跨卷 EXDEV 时退化成「复制 + 删除」）；
 *   4. 在**新路径**建工作区记录（官方 `create` 内部 realpath 归一化）；
 *   5. 把旧会话安顿到新节点：cwd 已经在新路径的**直接挂回**（保会话 id，
 *      这是「用户手动搬过目录」场景的最优解）；其余按官方 fork 种子机制复刻历史；
 *      什么都没安顿成时至少开一条空会话，免得新节点瞬间变「空工作区」；
 *   6. 其余旧会话归档 → 删旧工作区记录 → （best-effort）用 insertBefore 保持原排序位。
 *
 * 三处必须知道的失败语义（沿袭 @aeroscis/dsh-temptask 的 promote 编排）：
 *   - **第 3 步是唯一的破坏性动作，且它最早**：它失败时什么都没变（连会话都没动过账目）。
 *     Windows 上活着的会话/终端握着 cwd 时 `rename` 会 EBUSY/EPERM，如实翻译成
 *     `dirBusy` + 「先关掉该工作区的会话/终端再试」。
 *   - **第 4 步失败会把目录搬回去**（best-effort 回滚），避免「目录走了、节点没了」的半状态。
 *   - 第 5 步是**尽力而为**：带不上历史不影响迁移本身，缺口随结果返回给 UI。
 *
 * 与 `dsh-temptask` 那份 promote 的差别只有场景：那边服务于「临时任务 → 正式工作区」，
 * 绑定任务账本（tasks.json、任务根目录守卫、候选试错）；这里是任意正式工作区，
 * 不带任务模型，而且多了一种「旧目录已死、会话早已在新路径上」的直接挂回路径。
 */
import { existsSync } from 'node:fs';
import { cp, rename, rm, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/** 机器可读错误码（client 据此只显示 message/hint）。 */
export const ERROR_CODES = {
    badRequest: 'badRequest',
    fs: 'fs',
    dirBusy: 'dirBusy',
    notFound: 'notFound',
    targetExists: 'targetExists',
    targetClaimed: 'targetClaimed',
    confirm: 'confirm',
};

/** 内部错误：带机器可读错误码；对外统一收敛成 ApiError（本模块不抛错出去）。 */
export class RelocateError extends Error {
    code;
    hint;
    constructor(code, message, hint) {
        super(message);
        this.code = code;
        this.hint = hint;
        this.name = 'RelocateError';
    }
}

/** 统一的错误信息提取。 */
export function messageOf(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}

/* ─────────────────────────── 名字与落点校验 ─────────────────────────── */

/** Windows 上非法的文件名字符（`:` 只在盘符位置合法，作为目录名一律拒绝）。 */
const INVALID_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/u;
/** Windows 保留设备名（大小写无关；带扩展名也算，例如 `con.txt`）。 */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;

/**
 * 校验「新目录名」。搬移模式下名字同时是新节点标题，所以这里的要求就是文件系统的要求：
 * 单段、非空、不含分隔符/穿越、不是 `.`/`..`、Windows 上还要避开非法字符与保留名。
 */
export function validateName(name) {
    const candidate = name.trim();
    if (candidate.length === 0)
        return '目录名不能为空';
    if (basename(candidate) !== candidate)
        return '目录名只能是单段路径，不能含路径分隔符';
    if (candidate === '.' || candidate === '..')
        return '目录名不能是 . 或 ..';
    if (process.platform === 'win32') {
        if (INVALID_NAME_CHARS.test(candidate))
            return '目录名含 Windows 不允许的字符（< > : " | ? *）';
        if (RESERVED_NAMES.test(candidate))
            return `「${candidate}」是 Windows 保留名`;
        if (/[. ]$/u.test(candidate))
            return '目录名不能以空格或点结尾（Windows 会静默去掉它们）';
    }
    return undefined;
}

/** Windows 保留名/非法字符的检查只对「搬出来的新名字」有意义；沿用 promote 的语义。 */
export function validateParentDir(parentDir) {
    const absolute = resolve(parentDir.trim());
    if (!isAbsolute(absolute))
        throw new RelocateError(ERROR_CODES.badRequest, '目标父目录必须是绝对路径');
    return absolute;
}

/** 目标是否被占用（目录或文件都算占用——绝不覆盖任何东西）。 */
export function occupied(path) {
    return existsSync(path);
}

/** 两个路径是否指同一处（win32 上大小写不敏感；两侧都应是 resolve 归一化后的绝对路径）。 */
export function pathsEqual(left, right) {
    if (left === right)
        return true;
    if (process.platform !== 'win32')
        return false;
    return left.toLowerCase() === right.toLowerCase();
}

/** 目标是否落在某个目录内部（`.inner` 收尾也算内部）。 */
export function isInsideRoot(root, candidate) {
    // 分隔符跟平台走：Windows 上是 `\`，POSIX 上是 `/`。写死 `\` 会让 Linux 上的
    // 判断恒为 false（`/a/b` 不以 `/a\` 开头），CI 上就是这么炸的。
    const rooted = root.endsWith('\\') || root.endsWith('/') ? root : `${root}${sep}`;
    const normalized = resolve(candidate);
    const probe = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    const rootProbe = process.platform === 'win32' ? rooted.toLowerCase() : rooted;
    return probe.startsWith(rootProbe);
}

/* ─────────────────────────── 搬目录 ─────────────────────────── */

/** Windows 上「目录被占用」的一族 errno：活着的会话/终端握着 cwd，或权限不足。 */
function isBusyError(error) {
    const code = error.code;
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY';
}

/**
 * 把目录搬到新位置。
 *
 * `rename` 是首选（原地、原子、瞬时）；跨卷时 Node 会抛 `EXDEV`，
 * 这时退化成「递归复制 + 删除源」，并如实返回 `copy` 让 UI 能解释耗时。
 *
 * @returns `'rename' | 'copy'`
 */
export async function moveDirectory(from, to) {
    try {
        await rename(from, to);
        return 'rename';
    }
    catch (error) {
        const code = error.code;
        if (code === 'EXDEV') {
            try {
                // errorOnExist + force:false：目标已经被上层查过不存在，这里再兜一层。
                await cp(from, to, { recursive: true, errorOnExist: true, force: false });
            }
            catch (copyError) {
                throw new RelocateError(ERROR_CODES.fs, `跨卷复制失败：${from} → ${to}`, messageOf(copyError));
            }
            try {
                await rm(from, { recursive: true, force: true });
            }
            catch (removeError) {
                // 新家已经就位，旧目录删不掉只是留个副本——不算失败，但必须说清楚。
                throw new RelocateError(ERROR_CODES.fs, `已复制到 ${to}，但旧目录删不掉：${from}`, `${messageOf(removeError)}\n新旧两份都在磁盘上；确认新家内容无误后手动删除旧目录即可。`);
            }
            return 'copy';
        }
        if (isBusyError(error)) {
            throw new RelocateError(ERROR_CODES.dirBusy, `搬不动这个目录（被占用）：${from}`, 'Windows 上目录会被「正在使用它的进程」锁住：先关掉该工作区的会话与终端（或先结束它正在跑的回合），再重试。');
        }
        throw new RelocateError(ERROR_CODES.fs, `搬目录失败：${from} → ${to}`, messageOf(error));
    }
}

/** 建记录失败时的回滚：把目录搬回去（best-effort，失败只返回 false 由调用方提示）。 */
export async function rollbackMove(from, to) {
    try {
        await rename(to, from);
        return true;
    }
    catch {
        try {
            await cp(to, from, { recursive: true, errorOnExist: true, force: false });
            await rm(to, { recursive: true, force: true });
            return true;
        }
        catch {
            return false;
        }
    }
}

/* ─────────────────────────── fork 种子（官方 fork 语义的最小实现） ─────────────────────────── */

/**
 * 官方 `buildForkSeed()` 的种子部分（语义照抄）：取「已完成前缀」，补一个
 * `session/end-seed`。尾巴收补（openTurnClosers）在这一场景恒为空——边界本身就是
 * 一个收尾过的时间点——所以整段省掉。
 *
 * 为什么不 import 官方模块：profile 里解析不到 `@deepseek-ai/dsh-session`，
 * 为 9 行语义新增一个与宿主同档的重依赖不划算。
 */
export function completedPrefixBoundary(events) {
    let end = -1;
    for (let index = 0; index < events.length; index += 1) {
        if (events[index]?.type === 'turn/end')
            end = index;
    }
    if (end < 0)
        return undefined;
    let boundary = end;
    for (let index = end + 1; index < events.length; index += 1) {
        const next = events[index];
        if (next === undefined)
            break;
        if (next.type === 'turn/start' ||
            (next.type === 'user/message' && next.surfaceOp === 'append') ||
            next.type === 'agent/inbox/spliced') {
            break;
        }
        boundary = index;
    }
    return boundary;
}

/**
 * 由来源会话的完整事件流造一份 fork 种子。
 *
 * @returns 可用的种子；`undefined` = 没有可继承的已完成前缀（调用方降级为「不带历史」）。
 */
export function buildSeed(events) {
    if (!Array.isArray(events))
        return undefined;
    // seq == 下标：官方 fork 也用 `events[boundary].seq !== boundary` 做前置校验，
    // 不成立时那一层会直接抛错。这里退回 undefined，让调用方走降级链。
    for (let index = 0; index < events.length; index += 1) {
        if (events[index]?.seq !== index)
            return undefined;
    }
    const boundary = completedPrefixBoundary(events);
    if (boundary === undefined)
        return undefined;
    const last = events[boundary];
    if (last === undefined)
        return undefined;
    const seed = events.slice(0, boundary + 1).map((event) => ({ ...event }));
    seed.push({
        type: 'session/end-seed',
        seq: boundary + 1,
        time: last.time,
        data: { inherited: true },
    });
    return { seed, inheritedEventCount: boundary + 1 };
}

/* ─────────────────────────── 会话原语（host 侧） ─────────────────────────── */

/** 生成符合 DSH 习惯的会话 ID。 */
export function mintSessionId() {
    return `session-${randomUUID()}`;
}

/** 会话是否仍活在 host 内存里。 */
export function isSessionLive(ctx, sessionId) {
    if (sessionId === undefined || sessionId.length === 0)
        return false;
    const sessions = ctx.get('sessions');
    if (sessions === undefined || typeof sessions.get !== 'function')
        return false;
    try {
        return sessions.get(sessionId) !== undefined;
    }
    catch {
        return false;
    }
}

/**
 * 中止会话正在进行的回合（best-effort，UI「停止」的同一入口）。
 * 只停当轮、不销毁会话——生命周期归创建它的 agent 工厂所有。
 */
export async function cancelSession(ctx, sessionId) {
    if (sessionId.length === 0)
        return false;
    const controller = ctx.get('sessionController');
    if (controller === undefined || typeof controller.cancel !== 'function')
        return false;
    try {
        await controller.cancel({ sessionId });
        return true;
    }
    catch {
        return false;
    }
}

/** 在指定工作目录创建一条不绑定工作空间的会话（sessionController 优先，agents 兜底）。 */
export async function createSessionForDir(ctx, cwd) {
    const controller = ctx.get('sessionController');
    if (controller !== undefined && typeof controller.create === 'function') {
        try {
            const created = await controller.create({ cwd });
            const sessionId = created !== null && typeof created === 'object' ? String(created.sessionId ?? '') : '';
            if (sessionId.length > 0)
                return { sessionId, via: 'sessionController' };
            return { sessionId: undefined, via: 'none', reason: 'sessionController 未返回 sessionId' };
        }
        catch (error) {
            const fallback = await createViaAgents(ctx, cwd);
            if (fallback.sessionId !== undefined)
                return fallback;
            return {
                sessionId: undefined,
                via: 'none',
                reason: `sessionController 创建失败：${messageOf(error)}`,
            };
        }
    }
    const fallback = await createViaAgents(ctx, cwd);
    if (fallback.sessionId !== undefined)
        return fallback;
    return {
        sessionId: undefined,
        via: 'none',
        reason: fallback.reason ?? '当前 DSH 未提供 sessionController / agents 服务',
    };
}

/** 降级：直接用 agents 工厂建会话（自带 cwd，无工作空间）。 */
async function createViaAgents(ctx, cwd) {
    const agents = ctx.get('agents');
    if (agents === undefined || typeof agents.create !== 'function') {
        return { sessionId: undefined, via: 'none', reason: '当前 DSH 未提供 agents 服务' };
    }
    try {
        const sessionId = mintSessionId();
        await agents.create({ sessionId, meta: { cwd } });
        return { sessionId, via: 'agents' };
    }
    catch (error) {
        return { sessionId: undefined, via: 'none', reason: `agents 创建会话失败：${messageOf(error)}` };
    }
}

/** 把会话挂进工作区（cwd realpath 硬校验相等，失败如实带回原因）。 */
export async function attachSessionToWorkspace(ctx, workspaceId, sessionId) {
    if (workspaceId === undefined || workspaceId.length === 0) {
        return { attached: false, reason: '工作区 id 缺失' };
    }
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined)
        return { attached: false, reason: '宿主未提供 workspaceRegistry' };
    const workspace = registry.get(workspaceId);
    if (workspace === undefined)
        return { attached: false, reason: `工作区 ${workspaceId} 不存在` };
    try {
        await workspace.attachSession(sessionId);
        return { attached: true };
    }
    catch (error) {
        return { attached: false, reason: messageOf(error) };
    }
}

/** 归档会话（旧记录删除前收账，免得掉进「未分组」）。返回是否成功。 */
export async function archiveSessionQuietly(ctx, sessionId) {
    if (sessionId === undefined || sessionId.length === 0)
        return false;
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined || typeof registry.archiveSession !== 'function')
        return false;
    try {
        await registry.archiveSession(sessionId);
        return true;
    }
    catch {
        /* 归档失败不影响迁移本身 */
        return false;
    }
}

/* ─────────────────────────── probe（对话框初始化用） ─────────────────────────── */

/**
 * 读取一个工作区的迁移前置信息：登记路径、目录是否还在、会话账目。
 * 不做任何写动作；运行中的会话数由 client 自己算（它有 status 通道）。
 */
export async function probeWorkspace(ctx, workspaceId) {
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined) {
        return { ok: false, code: ERROR_CODES.fs, message: '宿主未提供 workspaceRegistry，无法执行路径迁移' };
    }
    const workspace = registry.get(workspaceId);
    if (workspace === undefined) {
        return { ok: false, code: ERROR_CODES.notFound, message: `工作区 ${workspaceId} 不存在（可能已被删除或迁移）` };
    }
    const to = workspace.path;
    let dirExists = false;
    let isDirectory = false;
    try {
        const info = await stat(to);
        dirExists = true;
        isDirectory = info.isDirectory();
    }
    catch {
        /* 目录不存在 = 死路径，probe 的正常结果之一 */
    }
    return {
        ok: true,
        workspaceId,
        path: to,
        title: workspace.title,
        sessionCount: workspace.sessionIds.length,
        dirExists,
        isDirectory,
    };
}

/* ─────────────────────────── 会话安顿 ─────────────────────────── */

/**
 * 把旧工作区名下的会话安顿到新节点上。
 *
 * 对**每一条**旧会话（entity 账目顺序）做 decide：
 *   1. `header.cwd` realpath 已等于新路径 → **直接挂回**（保会话 id，日志原地不动）——
 *      「用户手动搬过目录」的场景一行数据都不用复制；
 *   2. 其余且 `withHistory`：用事件前缀种子复刻历史，cwd 换成新路径；
 *   3. 两样都不行（空会话 / 没有完整回合 / 服务缺失）→ 跳过，稍后归档。
 *
 * 一条都没安顿成（复刻为 0、挂回为 0）时开一条空会话，免得新节点瞬间变「空工作区」。
 */
async function settleSessions(deps, account, workspace, withHistory) {
    const { ctx, log } = deps;
    const to = workspace.path;
    const targetWorkspaceId = workspace.id;
    const attached = [];
    const carried = [];
    const skipped = [];
    let query;
    try {
        query = ctx.get('sessionQuery');
    }
    catch {
        query = undefined;
    }
    const canSeed = withHistory && query !== undefined && typeof query.observeSession === 'function';
    let seedMissingReason;
    const agents = ctx.get('agents');
    if (withHistory && (agents === undefined || typeof agents.create !== 'function')) {
        seedMissingReason = '宿主未提供 agents 服务，无法用种子重建会话';
    }
    for (const sessionId of account) {
        if (canSeed && seedMissingReason === undefined) {
            try {
                // 不传 projectionMode：默认投影才有 agentPreset（官方 fork 也是这么读来源会话的）。
                const observed = await query.observeSession(sessionId);
                const headerCwd = typeof observed?.header?.cwd === 'string' ? observed.header.cwd : undefined;
                /* 1) cwd 已经在新路径上 → 原会话直接挂回，id 不变。 */
                let alreadyThere = false;
                if (headerCwd !== undefined && isAbsolute(resolve(headerCwd))) {
                    try {
                        alreadyThere = pathsEqual(await realpath(resolve(headerCwd)), to);
                    }
                    catch {
                        alreadyThere = false;
                    }
                }
                if (alreadyThere) {
                    const attach = await attachSessionToWorkspace(ctx, targetWorkspaceId, sessionId);
                    if (attach.attached) {
                        attached.push(sessionId);
                        continue;
                    }
                    skipped.push(`${sessionId}（原路径已在新家但挂回失败：${attach.reason ?? ''}）`);
                    continue;
                }
                /* 2) 复刻：事件前缀当种子，cwd 换成新路径。 */
                if (observed === undefined || !Array.isArray(observed.events)) {
                    skipped.push(`${sessionId}（读不到事件流）`);
                    continue;
                }
                const built = buildSeed(observed.events);
                if (built === undefined) {
                    skipped.push(`${sessionId}（没有已完成的回合可继承）`);
                    continue;
                }
                /* 装配顺序逐条对齐官方 ApiSessionAgentController.create()：
                   agentOptions ← agentDefaultModel、setup/agentPreset ← agentPresets。 */
                const presets = ctx.get('agentPresets');
                let agentPreset;
                let setup;
                if (presets !== undefined && typeof presets.resolve === 'function') {
                    try {
                        const requested = observed.projections?.values?.agentPreset;
                        const resolved = await presets.resolve(requested);
                        agentPreset = resolved.id;
                        if (typeof presets.mount === 'function') {
                            const presetId = resolved.id;
                            setup = async (agentCtx) => {
                                await presets.mount(agentCtx, presetId);
                            };
                        }
                    }
                    catch (error) {
                        log('warn', `解析 Agent 预设失败，按默认装配建会话（${messageOf(error)}）`);
                    }
                }
                const defaultModel = ctx.get('agentDefaultModel');
                let agentOptions;
                if (defaultModel !== undefined && typeof defaultModel.currentSelection === 'function') {
                    try {
                        const selection = defaultModel.currentSelection();
                        agentOptions = { provider: selection.provider, model: selection.model };
                    }
                    catch {
                        /* 拿不到就用宿主默认 */
                    }
                }
                const sessionIdNew = mintSessionId();
                await agents.create({
                    sessionId: sessionIdNew,
                    seed: built.seed,
                    inheritedEventCount: built.inheritedEventCount,
                    meta: {
                        cwd: to,
                        parentSession: sessionId,
                        isSeeded: true,
                        ...(agentPreset === undefined ? {} : { agentPreset }),
                    },
                    ...(agentOptions === undefined ? {} : { agentOptions }),
                    ...(setup === undefined ? {} : { setup }),
                });
                const attach = await attachSessionToWorkspace(ctx, targetWorkspaceId, sessionIdNew);
                if (!attach.attached) {
                    log('warn', `复刻的会话 ${sessionIdNew} 未能挂进新节点（${attach.reason ?? ''}）`);
                }
                carried.push({ sourceSessionId: sessionId, sessionId: sessionIdNew });
            }
            catch (error) {
                skipped.push(`${sessionId}（${messageOf(error)}）`);
            }
        }
        else {
            skipped.push(sessionId);
        }
    }
    if (seedMissingReason !== undefined)
        skipped.push(`（${seedMissingReason}）`);
    /* 3) 一条都没安顿成 → 开一条空会话占住节点。 */
    let createdPlainSessionId;
    if (attached.length === 0 && carried.length === 0) {
        const plain = await createSessionForDir(ctx, to);
        if (plain.sessionId !== undefined) {
            const attach = await attachSessionToWorkspace(ctx, targetWorkspaceId, plain.sessionId);
            if (!attach.attached) {
                log('warn', `新会话 ${plain.sessionId} 未能挂进新节点（${attach.reason ?? ''}）`);
            }
            createdPlainSessionId = plain.sessionId;
        }
        else {
            skipped.push(`（降级会话也没能创建：${plain.reason ?? '未知原因'}）`);
        }
    }
    return { attached, carried, skipped, createdPlainSessionId };
}

/* ─────────────────────────── probe 之外的主流程 ─────────────────────────── */

/**
 * 执行路径迁移。**不抛错**：所有失败都收敛成 `{ ok:false, ... }`。
 *
 * @param request `workspaceId` / `targetPath`（完整绝对路径）/ `moveDir`（是否连目录一起搬）
 *                / `carry`（是否复刻对话历史）/ `confirm`（二次确认门）。
 */
export async function relocateWorkspace(ctx, log, request) {
    const workspaceId = typeof request.workspaceId === 'string' ? request.workspaceId.trim() : '';
    const targetPath = typeof request.targetPath === 'string' ? request.targetPath.trim() : '';
    const moveDir = request.moveDir === true;
    const carry = request.carry !== false;
    const fail = (error) => {
        if (error instanceof RelocateError) {
            const payload = { ok: false, code: error.code, message: error.message };
            if (error.hint !== undefined)
                payload.hint = error.hint;
            return payload;
        }
        return { ok: false, code: ERROR_CODES.fs, message: messageOf(error) };
    };
    if (request.confirm !== true) {
        return {
            ok: false,
            code: ERROR_CODES.confirm,
            message: '路径迁移包含搬目录/改登记等持久动作，需要二次确认',
            hint: '客户端应弹出确认框后带 confirm: true 重试。',
        };
    }
    let registry;
    try {
        registry = ctx.get('workspaceRegistry');
    }
    catch {
        registry = undefined;
    }
    if (registry === undefined) {
        return { ok: false, code: ERROR_CODES.fs, message: '宿主未提供 workspaceRegistry，无法执行路径迁移' };
    }
    try {
        /* 1) 找工作区 + 读会话账目（必须在删记录之前读）。 */
        const workspace = registry.get(workspaceId);
        if (workspace === undefined) {
            return fail(new RelocateError(ERROR_CODES.notFound, `工作区 ${workspaceId} 不存在（可能已被删除或迁移）`));
        }
        const from = workspace.path;
        const account = [...workspace.sessionIds];
        /* 2) 目标路径的静态校验。 */
        if (targetPath.length === 0)
            return fail(new RelocateError(ERROR_CODES.badRequest, '请填写新路径'));
        const target = resolve(targetPath);
        if (!isAbsolute(target))
            return fail(new RelocateError(ERROR_CODES.badRequest, '新路径必须是绝对路径'));
        if (pathsEqual(target, from))
            return fail(new RelocateError(ERROR_CODES.badRequest, '新路径和当前路径相同'));
        /* resolveByPath 内部会对输入做 realpath 归一化：目标目录还不存在时抛 ENOENT，
           那不是被占用，而是「查询不到」——原样透传会把制造未存在的路径变成硬错误。 */
        let claimed;
        try {
            claimed = await registry.resolveByPath(target);
        }
        catch (error) {
            if (error?.code !== 'ENOENT')
                return fail(new RelocateError(ERROR_CODES.fs, `查询目标路径归属失败：${messageOf(error)}`));
            claimed = undefined;
        }
        if (claimed !== undefined && claimed.id !== workspaceId) {
            return fail(new RelocateError(ERROR_CODES.targetClaimed, `目标路径已被其他工作区占用：${claimed.path}（${claimed.title}）`, '先移除或迁移那个工作区，再选别的路径。'));
        }
        /* 3) 目录状态决定走「搬移」还是「重绑」。 */
        let dirInfo;
        try {
            dirInfo = await stat(from);
        }
        catch {
            dirInfo = undefined;
        }
        const dirExists = dirInfo !== undefined && dirInfo.isDirectory();
        const moving = moveDir && dirExists;
        let targetReal;
        if (moving) {
            const name = basename(target);
            const nameIssue = validateName(name);
            if (nameIssue !== undefined)
                return fail(new RelocateError(ERROR_CODES.badRequest, nameIssue));
            if (isInsideRoot(from, target))
                return fail(new RelocateError(ERROR_CODES.badRequest, '目标不能放在原目录内部'));
            if (isInsideRoot(target, from))
                return fail(new RelocateError(ERROR_CODES.badRequest, '原目录不能放在目标内部'));
            if (occupied(target)) {
                return fail(new RelocateError(ERROR_CODES.targetExists, `目标已存在：${target}`, '绝不覆盖已有内容；换个名字或换个父目录。'));
            }
            try {
                const parent = validateParentDir(dirname(target));
                const parentInfo = await stat(parent);
                if (!parentInfo.isDirectory()) {
                    return fail(new RelocateError(ERROR_CODES.badRequest, `目标父目录不是一个目录：${parent}`, '换一个目录，或把这一项清空后重新填写。'));
                }
            }
            catch (error) {
                if (error instanceof RelocateError)
                    return fail(error);
                if (error.code === 'ENOENT') {
                    return fail(new RelocateError(ERROR_CODES.badRequest, `目标父目录不存在：${dirname(target)}`, '先用「浏览…」在目标位置新建文件夹（或先在文件管理器里建好），再回来迁移。'));
                }
                return fail(new RelocateError(ERROR_CODES.fs, `无法访问目标父目录：${dirname(target)}`, messageOf(error)));
            }
        }
        else {
            /* 重绑语义：目标必须已经存在（「绑定到另一个文件夹」）。 */
            try {
                const info = await stat(target);
                if (!info.isDirectory()) {
                    return fail(new RelocateError(ERROR_CODES.badRequest, `目标不是一个目录：${target}`));
                }
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    return fail(new RelocateError(ERROR_CODES.badRequest, `目标目录不存在：${target}`, dirExists
                        ? '只改登记时要求目标已存在；想连目录一起搬，请勾选「把文件夹一起搬走」。'
                        : '原目录就不在了，重绑要求新文件夹已经存在（到文件管理器里建好或先搬好再回来）。'));
                }
                return fail(new RelocateError(ERROR_CODES.fs, `无法访问目标目录：${target}`, messageOf(error)));
            }
            try {
                targetReal = await realpath(target);
            }
            catch (error) {
                return fail(new RelocateError(ERROR_CODES.fs, `目标目录无法解析：${target}`, messageOf(error)));
            }
        }
        /* 4) 中止活着的回合（best-effort）。 */
        let canceled = 0;
        for (const sessionId of account) {
            if (!isSessionLive(ctx, sessionId))
                continue;
            if (await cancelSession(ctx, sessionId))
                canceled += 1;
        }
        /* 5) 搬目录（唯一的破坏性动作，且最早：失败则什么都没变）。 */
        let moved = false;
        if (moving) {
            moved = await moveDirectory(from, target);
            try {
                targetReal = await realpath(target);
            }
            catch (error) {
                const rolledBack = await rollbackMove(from, target);
                return fail(new RelocateError(ERROR_CODES.fs, `目录已搬到 ${target}，但无法解析它（${messageOf(error)}）${rolledBack ? '；目录已搬回原位' : ''}`, rolledBack ? undefined : `目录现在在 ${target}；可在侧边栏手动把该目录添加为工作区。`));
            }
        }
        /* 6) 新家建工作区记录；失败把目录搬回去，不留半状态。 */
        let fresh;
        try {
            fresh = await registry.create(target);
        }
        catch (error) {
            if (moving) {
                const rolledBack = await rollbackMove(from, target);
                return fail(new RelocateError(ERROR_CODES.fs, `${moved === 'copy' ? '目录已复制到' : '目录已搬到'} ${target}，但没能建出工作区记录：${messageOf(error)}${rolledBack ? '（目录已搬回原位）' : ''}`, rolledBack
                    ? undefined
                    : `目录现在在 ${target}；可在侧边栏手动把该目录添加为工作区。`));
            }
            return fail(new RelocateError(ERROR_CODES.fs, `无法在新路径建工作区记录：${messageOf(error)}`));
        }
        const to = fresh.path;
        /* 7) 安顿会话（尽力而为，不影响迁移本身）。 */
        const settled = await settleSessions({ ctx, log }, account, fresh, carry);
        /* 8) 归档剩下的旧会话（直接挂回的不算——它们已经在新节点上了）。 */
        const attachedSet = new Set(settled.attached);
        let archived = 0;
        for (const sessionId of account) {
            if (attachedSet.has(sessionId))
                continue;
            if (await archiveSessionQuietly(ctx, sessionId))
                archived += 1;
        }
        /* 9) 删旧工作区记录。 */
        let oldRecordRemoved = false;
        try {
            oldRecordRemoved = (await registry.delete(workspaceId)) === true;
        }
        catch (error) {
            log('warn', `旧工作区记录未能删除（${messageOf(error)}）`);
        }
        /* 10) 保住侧边栏排序位（best-effort；没有 insertBefore 就让引擎自己排）。 */
        let orderKept = false;
        try {
            const order = registry.list().map((item) => item.id);
            const nextId = order[order.indexOf(workspaceId) + 1];
            if (typeof registry.insertBefore === 'function' && nextId !== undefined) {
                await registry.insertBefore(fresh.id, nextId);
                orderKept = true;
            }
        }
        catch (error) {
            log('warn', `保持排序位失败（${messageOf(error)}）`);
        }
        log('info', `relocated ${workspaceId}: ${from} → ${to} (moved: ${moved === false ? 'no' : moved}, attached: ${settled.attached.length}, carried: ${settled.carried.length}, archived: ${archived}, canceled: ${canceled})`);
        const result = {
            ok: true,
            from,
            to,
            oldWorkspaceId: workspaceId,
            newWorkspaceId: fresh.id,
            moved,
            attached: settled.attached,
            carried: settled.carried,
            createdPlainSessionId: settled.createdPlainSessionId,
            skipped: settled.skipped,
            archived,
            canceled,
            oldRecordRemoved,
            orderKept,
        };
        return result;
    }
    catch (error) {
        return fail(error);
    }
}
