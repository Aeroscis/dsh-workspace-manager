/**
 * Host half.
 *
 * The plugin keeps its browser half as the surface (panel, ordering, engine).
 * The host half exists for one feature only: workspace path relocation —
 * moving a workspace's directory and/or re-registering its entry — because
 * that needs Node (fs, session forks, the official workspace registry).
 *
 * Syscall primitives and the orchestration live in lib/relocate.js; the HTTP
 * bridge lives in lib/routes.js. All services are optional (ctx.get + graceful
 * degradation), so the plugin still loads on hosts missing any of them and the
 * client reports the capability gap instead of silently breaking.
 */
import { createRoutes, API_PREFIX } from './lib/routes.js';
import { readFileSync } from 'node:fs';

export const name = '@aeroscis/dsh-workspace-manager';

/** 现读 package.json：手写常量必漂（temp 任务 0.4.0 就只改了一处），这里报"这个包装的是哪一版"。 */
export const version = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;

export const inject = [];

export function apply(ctx) {
  const log = (level, message) => {
    const logger = ctx.logger;
    if (logger === undefined) return
    const write = logger[level] ?? logger.info
    try {
      write?.call(logger, `[workspace-manager] ${message}`)
    } catch {
      /* logging must never break business flow */
    }
  }

  ctx.inject(['webServer'], (sctx) => {
    const webServer = sctx.get('webServer')
    if (webServer === undefined) return
    const routeHost = {
      ctx,
      log,
      trustedHosts: () => {
        const connection = ctx.get('connection')
        const hosts = connection?.trustedHosts
        return Array.isArray(hosts) ? hosts.filter((host) => typeof host === 'string') : []
      },
    }
    const routes = createRoutes(routeHost)
    const disposers = routes.map((route) =>
      webServer.register({
        kind: 'exact',
        path: route.path,
        handler: (req, res) => route.handle(req, res),
      }),
    )
    log('info', `mounted ${routes.length} routes under ${API_PREFIX}/*`)
    sctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'workspace-manager: http routes')
  })
}

export default { name, version, inject, apply }
