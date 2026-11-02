/**
 * Workspace Manager — host HTTP routes.
 *
 * Only two endpoints, both talking to lib/relocate.js:
 *   GET  /dsh-workspace-manager/api/probe     — preflight info for the dialog
 *   POST /dsh-workspace-manager/api/relocate  — the orchestrated move/rebind
 *
 * Trust model mirrors the official web origin: loopback or declared authority,
 * same-origin request only. All handlers always answer JSON (200 with
 * `{ ok:false, ... }` on failure) so the client never has to parse raw errors.
 */
import { ERROR_CODES, messageOf, probeWorkspace, relocateWorkspace } from './relocate.js';

export const API_PREFIX = '/dsh-workspace-manager/api';
/** 迁移载荷很小（一个路径 + 三个开关），上限设小一点。 */
const MAX_BODY_BYTES = 16 * 1024;

/* ─────────────────────────── HTTP 工具 ─────────────────────────── */
function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
    });
    res.end(body);
}

async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('请求体过大');
        chunks.push(buffer);
    }
    if (size === 0)
        return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function asObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

/** 判断 Host 是否是 loopback authority。 */
function isLoopbackAuthority(host) {
    const lower = host.toLowerCase();
    const name = lower.startsWith('[')
        ? lower.slice(0, lower.indexOf(']') + 1)
        : (lower.split(':')[0] ?? '');
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/** 请求是否可信（同源 + 非跨站 + loopback/已声明 authority）。 */
function isTrustedRequest(req, trustedHosts) {
    const host = req.headers.host;
    if (typeof host === 'string' && host.length > 0) {
        const trusted = isLoopbackAuthority(host) ||
            trustedHosts.some((entry) => entry.toLowerCase() === host.toLowerCase());
        if (!trusted)
            return false;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const origin = req.headers.origin;
    // 浏览器一定会带 Origin；缺失说明请求不是页面发出的（中间层代理会剥离它）。
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
}

/** 统一异常 → ApiError，保证接口永远返回 JSON。 */
function toApiError(error) {
    return { ok: false, code: ERROR_CODES.badRequest, message: messageOf(error) };
}

/* ─────────────────────────── 路由构造 ─────────────────────────── */

export function createRoutes(host) {
    const { ctx, log } = host;
    /** 统一的处理器包装：方法检查 + 同源检查 + JSON 响应。 */
    function route(path, method, impl) {
        return {
            path,
            async handle(req, res) {
                try {
                    if ((req.method ?? 'GET').toUpperCase() !== method) {
                        res.setHeader('allow', method);
                        sendJson(res, 405, { ok: false, code: ERROR_CODES.badRequest, message: `本接口只接受 ${method}` });
                        return;
                    }
                    if (!isTrustedRequest(req, host.trustedHosts())) {
                        sendJson(res, 403, {
                            ok: false,
                            code: ERROR_CODES.badRequest,
                            message: 'untrusted origin：请求来源不是本机回环或已声明的 authority',
                        });
                        return;
                    }
                    const body = method === 'POST' ? asObject(await readJsonBody(req)) : {};
                    const url = new URL(req.url ?? '/', 'http://local');
                    const result = await impl(body, url);
                    sendJson(res, 200, result);
                }
                catch (error) {
                    log('warn', `${path} 处理失败：${messageOf(error)}`);
                    sendJson(res, 200, toApiError(error));
                }
            },
        };
    }
    return [
        // 预检：对话框初始化（登记路径/目录是否还在/会话账目）。
        route(`${API_PREFIX}/probe`, 'GET', async (_body, url) => {
            const workspaceId = (url.searchParams.get('workspaceId') ?? '').trim();
            if (workspaceId.length === 0) {
                return { ok: false, code: ERROR_CODES.badRequest, message: '缺少 workspaceId' };
            }
            return probeWorkspace(ctx, workspaceId);
        }),
        // 执行迁移：搬目录/重绑 + 会话安顿 + 记录换新。
        route(`${API_PREFIX}/relocate`, 'POST', async (body) => await relocateWorkspace(ctx, host.log, body)),
    ];
}
