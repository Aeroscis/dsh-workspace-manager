/**
 * Workspace Manager — browser half.
 *
 * Entry point: the launcher button is a real child of the official workspaces
 * panel header, inserted in the free space between the section title and the
 * search field. Because it sits in that flex row it scrolls, slides and
 * collapses together with the dock, exactly like the shipped buttons; nothing
 * is positioned with coordinates. The shipped action group (width-locked to
 * two buttons) is left untouched. The popover itself renders in the
 * shell.overlay slot and follows the button.
 *
 * Ordering uses only official Client APIs:
 *   ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)   (Host-persisted order)
 *   ctx.workspaces.delete(workspaceId)                            (removes the registration only)
 *
 * Path relocation works through the Host half (index.js + lib/): moving the
 * folder, re-registering the workspace entry and carrying conversations over
 * need Node (fs, session seeds, the official workspace registry). The row
 * action opens an inline dialog; the probe result decides whether "move the
 * folder too" is offered or the dialog degrades to a plain rebind.
 *
 * Every row carries a drag handle on its left edge; dragging it resolves a
 * drop index from the row rectangles and then writes the whole desired order
 * through insertBefore. The pin toggle lives on the right edge.
 *
 * The engine maintains one invariant: pinned workspaces first, then running
 * workspaces, then the workspace that most recently received a human prompt,
 * then the rest. Merely opening a Session is not activity: the Session list
 * stamps `updatedAt` from the persisted last human prompt, so `retainedBy`
 * changes made by viewing a Session never move it.
 *
 * Everything is a durable Host write; there is no view-only order.
 */
window.__ModuleLoader__.load({
  id: '@aeroscis/dsh-workspace-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'workspaceManager'
    const PREFS_KEY = 'dsh-workspace-manager:prefs:v1'
    const STYLE_ID = 'wsm-styles'

    // ---------------------------------------------------------------- locale
    const DICT = {
      zh: {
        title: '工作区管理',
        open: '打开工作区管理',
        close: '关闭',
        autoRise: '活动自动上浮',
        autoRiseHint: '只有你发送新消息才算活动；打开会话不会上浮。',
        sortNow: '一键整理',
        pin: '置顶',
        unpin: '取消置顶',
        drag: '拖动调整顺序',
        remove: '移除',
        cancel: '取消',
        removeTitle: '移除「{name}」？',
        removeBody: '该工作区的 {n} 个会话会归入「未分组」，不会被删除。',
        removeRunning: '其中 {n} 个会话正在运行。',
        cleanEmpty: '清理空工作区',
        cleanEmptyCount: '清理空工作区（{n}）',
        cleanTitle: '将移除 {n} 个空工作区',
        cleanBody: '这些工作区没有会话，移除只影响工作区列表。',
        failed: '操作失败：{message}',
        sessions: '{n} 个会话',
        running: '{n} 运行中',
        none: '没有工作区',
        noMatch: '没有匹配的工作区',
        filterPlaceholder: '筛选：按名称',
        openFolder: '在文件管理器中打开',
        resizeWidth: '拖动调整宽度（双击恢复默认）',
        repath: '修改路径',
        repathTitle: '修改「{name}」的路径',
        repathDeadTitle: '重新绑定「{name}」（原目录已不存在）',
        repathFrom: '当前路径：',
        repathToLabel: '新路径（完整绝对路径）',
        repathToPlaceholder: '例如 D:\\projects\\new-name',
        repathMove: '把文件夹一起搬过去',
        repathMoveDeadNote: '原目录已不存在：这次只改登记，把工作区绑定到新位置的文件夹。',
        repathNoMoveNote: '只改登记路径：目录原地不动。',
        repathCarry: '把对话带过去',
        repathCarryNone: '该工作区没有会话，无需迁移对话。',
        repathRunningWarn: '其中 {n} 个会话正在运行；迁移前会先中止它们的当前回合。',
        repathExecute: '执行迁移',
        repathProbeFailed: '读取 当前路径 失败：{message}',
        repathResultTitle: '迁移完成',
        repathMovedRename: '文件夹：已搬移',
        repathMovedCopy: '文件夹：已跨盘复制（旧目录可能残留，见日志）',
        repathNotMoved: '仅登记路径已更新，文件夹未搬动',
        repathAttached: '会话：{n} 条已在目标目录，直接挂回新节点（id 不变）',
        repathCarried: '会话：{n} 条已复刻历史并迁到新路径',
        repathPlainCreated: '已在新路径开一条空会话',
        repathArchived: '旧会话：{n} 条已归档',
        repathOrderKept: '排序位：已保持',
        repathOrderLost: '排序位：未能保持，可在面板手动整理',
        repathResultOk: '知道了',
      },
      en: {
        title: 'Workspace Manager',
        open: 'Open workspace manager',
        close: 'Close',
        autoRise: 'Active auto-rise',
        autoRiseHint: 'Only a prompt you send counts as activity; opening a Session never raises it.',
        sortNow: 'Sort now',
        pin: 'Pin',
        unpin: 'Unpin',
        drag: 'Drag to reorder',
        remove: 'Remove',
        cancel: 'Cancel',
        removeTitle: 'Remove “{name}”?',
        removeBody: 'Its {n} sessions move to Ungrouped and are not deleted.',
        removeRunning: '{n} of its sessions are running.',
        cleanEmpty: 'Clean empty workspaces',
        cleanEmptyCount: 'Clean empty workspaces ({n})',
        cleanTitle: 'Remove {n} empty workspaces',
        cleanBody: 'They have no sessions; only the workspace list changes.',
        failed: 'Operation failed: {message}',
        sessions: '{n} sessions',
        running: '{n} running',
        none: 'No workspaces',
        noMatch: 'No matching workspaces',
        filterPlaceholder: 'Filter by name',
        openFolder: 'Open in file manager',
        resizeWidth: 'Drag to resize (double-click to reset)',
        repath: 'Change path',
        repathTitle: 'Change path of “{name}”',
        repathDeadTitle: 'Rebind “{name}” (directory is gone)',
        repathFrom: 'Current path: ',
        repathToLabel: 'New path (full absolute path)',
        repathToPlaceholder: 'e.g. D:\\projects\\new-name',
        repathMove: 'Move the folder too',
        repathMoveDeadNote: 'The registered directory no longer exists: only the registration changes, now bound to the folder at the new path.',
        repathNoMoveNote: 'Registration only: the folder stays where it is.',
        repathCarry: 'Carry the conversations over',
        repathCarryNone: 'This workspace has no sessions; nothing to carry.',
        repathRunningWarn: '{n} of its sessions are running; their current turn is cancelled before the move.',
        repathExecute: 'Migrate',
        repathProbeFailed: 'Failed to read current path: {message}',
        repathResultTitle: 'Migration finished',
        repathMovedRename: 'Folder: moved',
        repathMovedCopy: 'Folder: copied across volumes (the old copy may remain; see logs)',
        repathNotMoved: 'Only the registered path changed; the folder did not move',
        repathAttached: 'Sessions: {n} already at the target, re-attached as-is (same ids)',
        repathCarried: 'Sessions: {n} replanted with their history at the new path',
        repathPlainCreated: 'A fresh empty session opened at the new path',
        repathArchived: 'Old sessions: {n} archived',
        repathOrderKept: 'Sidebar position: kept',
        repathOrderLost: 'Sidebar position: not kept; tidy it up manually',
        repathResultOk: 'OK',
      },
    }

    // ------------------------------------------------------------ tiny store
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(next) {
          if (next === state) return
          state = next
          for (const listener of [...listeners]) listener()
        },
        update(fn) {
          const next = fn(state)
          if (next !== state) {
            state = next
            for (const listener of [...listeners]) listener()
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    function useStore(store) {
      const subscribe = React.useCallback((cb) => store.subscribe(cb), [store])
      const getSnapshot = React.useCallback(() => store.get(), [store])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    function useSnapshot(store) {
      const subscribe = React.useCallback((cb) => store.subscribe(cb), [store])
      const getSnapshot = React.useCallback(() => store.getSnapshot(), [store])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    // ------------------------------------------------------- relocate API
    // The dialog always works through the Host half: the browser has no fs
    // access and no workspace registry, so both calls go to lib/routes.js.
    async function apiProbe(workspaceId) {
      const response = await fetch(
        `/dsh-workspace-manager/api/probe?workspaceId=${encodeURIComponent(workspaceId)}`,
      )
      const body = await response.json().catch(() => undefined)
      if (!body || body.ok !== true) {
        throw new Error(body?.message ?? `probe HTTP ${response.status}`)
      }
      return body
    }

    async function apiCapabilities() {
      const response = await fetch('/dsh-workspace-manager/api/capabilities')
      const body = await response.json().catch(() => undefined)
      if (!body || body.ok !== true) throw new Error(body?.message ?? `capabilities HTTP ${response.status}`)
      return body
    }

    async function apiOpenFolder(workspaceId) {
      const response = await fetch('/dsh-workspace-manager/api/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const body = await response.json().catch(() => undefined)
      if (!body) throw new Error(`open HTTP ${response.status}`)
      if (body.ok !== true) throw new Error(body.message ?? '打开失败')
      return body
    }

    async function apiRelocate(payload) {
      const response = await fetch('/dsh-workspace-manager/api/relocate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => undefined)
      if (!body) throw new Error(`relocate HTTP ${response.status}`)
      return body
    }

    // ---------------------------------------------------------- preferences
    function readPrefs() {
      const fallback = { autoRise: true, pinned: [], panelWidth: null }
      try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        return {
          autoRise: parsed.autoRise !== false,
          pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((id) => typeof id === 'string') : [],
          // null = 跟随内容自动定宽；数字 = 用户拖出来的宽度。
          panelWidth: Number.isFinite(parsed.panelWidth) && parsed.panelWidth > 0 ? Math.round(parsed.panelWidth) : null,
        }
      } catch {
        return fallback
      }
    }

    function writePrefs(value) {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(value))
      } catch {
        /* private mode: preferences stay in memory for this page */
      }
    }

    // --------------------------------------------------------------- helpers
    const sameOrder = (left, right) =>
      left.length === right.length && left.every((id, index) => id === right[index])

    // Drag-sort geometry (ported from dsh-rundeck): the dragged row follows the
    // pointer, the other rows translate to open its target slot, and the drop
    // index is a pure function of the measured row heights plus the pointer dy.
    function restTops(heights, gap) {
      const tops = []
      let y = 0
      for (const height of heights) {
        tops.push(y)
        y += height + gap
      }
      return tops
    }

    function moveInOrder(list, from, to) {
      const next = [...list]
      if (from === to || from < 0 || from >= next.length) return next
      const moved = next.splice(from, 1)[0]
      if (moved === undefined) return next
      next.splice(to, 0, moved)
      return next
    }

    function dropIndexFor(heights, gap, from, dy) {
      if (from < 0 || from >= heights.length) return Math.max(0, from)
      const tops = restTops(heights, gap)
      const center = (tops[from] ?? 0) + (heights[from] ?? 0) / 2 + dy
      let to = 0
      for (let index = 0; index < heights.length; index += 1) {
        if (index === from) continue
        if ((tops[index] ?? 0) + (heights[index] ?? 0) / 2 < center) to += 1
      }
      return to
    }

    function previewOffsets(heights, gap, from, to) {
      const tops = restTops(heights, gap)
      const offsets = heights.map(() => 0)
      let y = tops[0] ?? 0
      for (const id of moveInOrder(heights.map((_, index) => index), from, to)) {
        offsets[id] = y - (tops[id] ?? 0)
        y += (heights[id] ?? 0) + gap
      }
      return offsets
    }

    // Activity means a human prompt landed in this Session. The Session list
    // derives updatedAt from the persisted lastPromptAt; opening a Session only
    // moves retainedBy.mainView, so it never counts. Blank placeholders and
    // subagent children are not user activity either; a fork is a normal
    // Session and counts once you prompt in it.
    function sessionActivity(session) {
      if (!session || session.blank === true) return 0
      if (session.origin === 'subagent') return 0
      return typeof session.updatedAt === 'number' ? session.updatedAt : 0
    }

    function activityOf(workspace, byId) {
      let newest = 0
      for (const id of workspace.sessionIds) {
        const updated = sessionActivity(byId[id])
        if (updated > newest) newest = updated
      }
      return newest
    }

    function activeWorkspaceId(items, byId) {
      let winner
      let newest = 0
      for (const workspace of items) {
        const updated = activityOf(workspace, byId)
        if (updated > newest) {
          newest = updated
          winner = workspace.workspaceId
        }
      }
      return winner
    }

    // ----------------------------------------------------------------- icons
    // The manager button is a DOM node inside the official header rather than a
    // React element, so its icon ships as markup: the sync pass can rebuild the
    // node whenever the official row is replaced.
    const MANAGE_ICON_SVG =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" fill-rule="evenodd" aria-hidden="true">' +
      '<path d="M14.8 8L11.9 10.25L11.4 13.89L8 12.5L4.6 13.89L4.1 10.25L1.2 8L4.1 5.75L4.6 2.11L8 3.5L11.4 2.11L11.9 5.75Z' +
      'M10.2 8a2.2 2.2 0 1 0-4.4 0 2.2 2.2 0 1 0 4.4 0Z"></path></svg>'

    // Hamburger grip: three rules, the universal drag affordance.
    function iconGrip() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M3.2 4h9.6M3.2 8h9.6M3.2 12h9.6' }),
      )
    }

    // Push pin: outline while the workspace is free, solid once pinned.
    const PIN_PATH = 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z'

    function iconPin(filled) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: filled ? 0 : 1.7,
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: PIN_PATH }),
      )
    }

    function iconTrash() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M3 4.5h10M6.3 4.5V3.2h3.4v1.3M4.7 4.5l.5 8h5.6l.5-8' }),
      )
    }

    // Path change: a folder whose arrow points out of it (relocate/rebind).
    function iconRepath() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', {
          d:
            'M7.6 12.6H2.9c-.5 0-.9-.4-.9-.9v-7c0-.5.4-.9.9-.9h2.5l1.2 1.5h3.6c.5 0 .9.4.9.9v.8' +
            'M10 9.4l4.4-3.2M14.4 6.2h-2.6M14.4 6.2v2.6',
        }),
      )
    }

    // Plain folder: the action opens the directory, it does not move it.
    function iconFolder() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 13,
          height: 13,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M2.4 12.2V3.8c0-.4.3-.7.7-.7h2.4l1.2 1.5h5.2c.4 0 .7.3.7.7v6.9c0 .4-.3.7-.7.7H3.1c-.4 0-.7-.3-.7-.7Z',
        }),
      )
    }

    // ------------------------------------------------------------------ css
    const CSS = `
.wsm-launcher{flex:none;width:28px;height:28px;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.wsm-launcher:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wsm-launcher[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.wsm-card{position:fixed;z-index:901;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.34);font-size:13px;line-height:1.45;pointer-events:auto}
.wsm-card *{box-sizing:border-box}
.wsm-resize{position:absolute;top:0;right:0;bottom:0;width:7px;cursor:col-resize;touch-action:none;background:transparent}
.wsm-resize:hover,.wsm-resize:active{background:var(--dsw-alias-brand-primary);opacity:.32}
.wsm-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wsm-title{flex:1;font-size:13px;font-weight:600}
.wsm-close{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.wsm-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wsm-filterbar{flex:none;padding:9px 12px 0}
.wsm-filter{width:100%;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px}
.wsm-filter::placeholder{color:var(--dsw-alias-label-secondary)}
.wsm-filter:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.wsm-toolbar{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wsm-switch-row{display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 4px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;flex:none}
.wsm-switch-row:hover{background:var(--dsw-alias-bg-layer-2)}
.wsm-switch{position:relative;width:36px;height:20px;flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);transition:background .15s,border-color .15s}
.wsm-switch[data-on="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 82%,#000)}
.wsm-switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#8f8f96;box-shadow:0 0 0 1px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.35);transition:transform .15s}
.wsm-switch[data-on="true"] .wsm-switch-thumb{transform:translateX(16px)}
.wsm-switch-label{white-space:nowrap}
.wsm-spacer{flex:1}
.wsm-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
.wsm-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wsm-btn:disabled{opacity:.45;cursor:default}
.wsm-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.wsm-repath{margin:0 6px 8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.wsm-repath-current{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.wsm-repath-label{display:block;font-size:11.5px;font-weight:600;margin:10px 0 4px}
.wsm-repath-input{width:100%;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}
.wsm-repath-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.wsm-repath .wsm-switch-row{height:24px}
.wsm-repath .wsm-switch-row:disabled{opacity:.45;cursor:default;background:transparent}
.wsm-repath-toggle{margin-top:2px}
.wsm-repath-note{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.wsm-repath-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}
.wsm-sidebar-pin{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;justify-content:center;margin-left:2px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-state-warn-primary);cursor:pointer}
.wsm-sidebar-pin:hover{background:var(--dsw-alias-border-l1)}
.wsm-sidebar-pin:active{background:var(--dsw-alias-border-l2)}
.wsm-list{flex:1;min-height:0;overflow:auto;padding:4px 6px}
.wsm-empty{padding:18px 8px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wsm-row{position:relative;display:flex;align-items:center;gap:4px;padding:3px 4px 3px 2px;border-radius:6px}
.wsm-row:hover{background:var(--dsw-alias-bg-layer-2)}
.wsm-row[data-active="true"]{box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.wsm-row.wsm-rowDragging{position:relative;z-index:3;opacity:1;cursor:grabbing;background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 1px var(--dsw-alias-border-l3),0 10px 26px rgba(0,0,0,.32)}
.wsm-rowDragging .wsm-grip{cursor:grabbing}
.wsm-rowShift{transition:transform 180ms cubic-bezier(.2,0,0,1)}
.wsm-rowSettle{transition:transform 160ms cubic-bezier(.2,0,0,1)}
.wsm-grip{width:18px;height:24px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);opacity:.5;cursor:grab;touch-action:none}
.wsm-grip:hover{opacity:1;background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.wsm-grip:active{cursor:grabbing}
.wsm-row-main{flex:1;min-width:0}
.wsm-row-title{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsm-row-meta{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wsm-row-actions{flex:none;display:flex;align-items:center;gap:1px}
.wsm-icon{width:22px;height:22px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.wsm-icon:hover{background:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.wsm-pin[data-on="true"]{color:var(--dsw-alias-state-warn-primary)}
.wsm-reveal{opacity:0;transition:opacity .12s}
.wsm-row:hover .wsm-reveal,.wsm-row:focus-within .wsm-reveal{opacity:1}
.wsm-danger:hover{color:var(--dsw-alias-state-error-primary)}
.wsm-confirm{margin:2px 2px 6px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.wsm-confirm-title{font-size:12.5px;font-weight:600}
.wsm-confirm-body{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.wsm-confirm-warn{font-size:11.5px;color:var(--dsw-alias-state-warn-primary);margin-top:2px}
.wsm-confirm-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.wsm-clean{margin:0 6px 8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.wsm-foot{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.wsm-error{font-size:11px;color:var(--dsw-alias-state-error-primary);white-space:pre-line}
`

    // --------------------------------------------------------- header anchor
    // The shipped header clips its action group to 60px (exactly two buttons),
    // so a third control cannot live there without pushing the "add workspace"
    // button out of view. The launcher therefore sits in the header row itself,
    // in the free space between the section title and the search field: it is a
    // real flex item, so the dock moves it around like any official button.
    const LAUNCHER_ATTR = 'data-wsm-launcher'

    // ---------------------------------------------------------- panel width
    // Pure width math: the drag handle, the content-based default and the
    // viewport clamp all go through these, so they can be tested without a DOM.
    // `ROW_CHROME_WIDTH` is everything in a row that is not the title: grip,
    // four icon buttons, their gaps, row/list paddings and the card border.
    const PANEL_MIN_WIDTH = 300
    const PANEL_MAX_WIDTH = 760
    const ROW_CHROME_WIDTH = 150

    function clampPanelWidth(value, viewportWidth) {
      const viewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1024
      const ceiling = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, viewport - 24))
      const width = Number.isFinite(value) ? Math.round(value) : PANEL_MIN_WIDTH
      return Math.max(PANEL_MIN_WIDTH, Math.min(ceiling, width))
    }

    /** Default width: wide enough for the longest workspace name, capped by the viewport. */
    function preferredPanelWidth(titleWidth, viewportWidth) {
      const wanted = (Number.isFinite(titleWidth) ? titleWidth : 0) + ROW_CHROME_WIDTH
      return clampPanelWidth(Math.max(PANEL_MIN_WIDTH, wanted), viewportWidth)
    }

    // The popover hangs off the launcher's rectangle: left edge at the left edge
    // of the button, dropping below it. Width is the user's choice when they
    // dragged the right edge, otherwise the content-based default.
    function measure(anchorRect, widthOverride) {
      const header = document.querySelector('[class*="sectionHeader"]')
      const rootRect = header?.parentElement?.getBoundingClientRect()
      const headerRect = header?.getBoundingClientRect()
      const width = clampPanelWidth(
        Number.isFinite(widthOverride) ? widthOverride : Math.max(PANEL_MIN_WIDTH, (rootRect?.width ?? 300) - 12),
        window.innerWidth,
      )
      const anchored = anchorRect && Number.isFinite(anchorRect.left)
      const rawLeft = anchored ? anchorRect.left - 6 : (rootRect?.left ?? 64) + 6
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8))
      const top = anchored ? anchorRect.bottom + 8 : (headerRect?.bottom ?? 56) + 6
      return {
        left,
        top,
        width,
        maxHeight: Math.max(220, window.innerHeight - top - 16),
      }
    }

    // ---------------------------------------------------------------- plugin
    return {
      inject: ['slots', 'workspaces', 'sessions', 'locale', 'remote'],
      apply(ctx) {
        const prefs = createStore(readPrefs())
        prefs.subscribe(() => writePrefs(prefs.get()))

        const panel = createStore({ open: false })
        const runningMap = new Map()
        let pumping = false
        let again = false
        let timer
        // A pointer drag owns the order until it commits; the auto-rise engine
        // must not write a competing order from under the pointer.
        let pointerDragging = false

        const sessionRunning = (id, list) => runningMap.get(id) === true || list.byId[id]?.running === true
        const workspaceRunning = (workspace, list) =>
          workspace.sessionIds.some((id) => sessionRunning(id, list))

        const syncRunning = (list) => {
          const ids = Array.isArray(list.ids) ? list.ids : Object.keys(list.byId)
          for (const id of ids) {
            const row = list.byId[id]
            if (row && typeof row.running === 'boolean') runningMap.set(id, row.running)
          }
        }

        const applyOrder = async (desired) => {
          let current = ctx.workspaces.list.getSnapshot().items.map((w) => w.workspaceId)
          if (sameOrder(current, desired)) return false
          let moved = false
          for (let index = 0; index < desired.length; index += 1) {
            if (current[index] === desired[index]) continue
            const id = desired[index]
            if (!current.includes(id)) continue
            const before = current[index]
            await ctx.workspaces.insertBefore(id, before)
            moved = true
            current = current.filter((candidate) => candidate !== id)
            current.splice(Math.min(index, current.length), 0, id)
          }
          return moved
        }

        const desiredSortOrder = () => {
          const items = ctx.workspaces.list.getSnapshot().items
          const list = ctx.sessions.list.getSnapshot()
          syncRunning(list)
          const p = prefs.get()
          const order = items.map((w) => w.workspaceId)
          const pinned = p.pinned.filter((id) => order.includes(id))
          const byIdMap = new Map(items.map((w) => [w.workspaceId, w]))
          const activeId = activeWorkspaceId(items, list.byId)
          const rest = items.filter((w) => !pinned.includes(w.workspaceId))
          const runningRows = rest
            .filter((w) => workspaceRunning(w, list))
            .sort((a, b) => activityOf(b, list.byId) - activityOf(a, list.byId))
          const activeRow =
            activeId && !pinned.includes(activeId) && !runningRows.some((w) => w.workspaceId === activeId)
              ? byIdMap.get(activeId)
              : undefined
          const idleRows = rest
            .filter((w) => w !== activeRow && !runningRows.includes(w))
            .sort((a, b) => activityOf(b, list.byId) - activityOf(a, list.byId))
          return [
            ...pinned.map((id) => byIdMap.get(id)),
            ...runningRows,
            ...(activeRow ? [activeRow] : []),
            ...idleRows,
          ]
            .filter(Boolean)
            .map((w) => w.workspaceId)
        }

        const sortNow = () => applyOrder(desiredSortOrder())

        const step = async () => {
          if (pointerDragging) return false
          const items = ctx.workspaces.list.getSnapshot().items
          if (items.length < 2) return false
          const list = ctx.sessions.list.getSnapshot()
          syncRunning(list)
          const order = items.map((w) => w.workspaceId)
          const p = prefs.get()

          const pinned = p.pinned.filter((id) => order.includes(id))
          if (pinned.length) {
            const desired = [...pinned, ...order.filter((id) => !pinned.includes(id))]
            if (!sameOrder(order, desired)) {
              await applyOrder(desired)
              return true
            }
          }

          if (!p.autoRise) return false
          const activeId = activeWorkspaceId(items, list.byId)
          if (activeId === undefined) return false
          const active = items.find((w) => w.workspaceId === activeId)
          if (!active || pinned.includes(active.workspaceId)) return false

          const isRunning = (id) => {
            const workspace = items.find((w) => w.workspaceId === id)
            return workspace ? workspaceRunning(workspace, list) : false
          }
          // The active row belongs above the first row that is neither pinned
          // nor running. Skipping running alone is not enough: with a pinned
          // row present, active would be inserted above the pin, the pin pass
          // would move it back, and the two passes would fight every tick.
          const boundary = order.find(
            (id) => id !== active.workspaceId && !pinned.includes(id) && !isRunning(id),
          )
          if (boundary === undefined) return false
          if (order.indexOf(active.workspaceId) < order.indexOf(boundary)) return false

          const desired = order.filter((id) => id !== active.workspaceId)
          desired.splice(desired.indexOf(boundary), 0, active.workspaceId)
          if (sameOrder(order, desired)) return false
          await applyOrder(desired)
          return true
        }

        const pump = async () => {
          if (pumping) {
            again = true
            return
          }
          pumping = true
          try {
            for (let pass = 0; pass < 8; pass += 1) {
              again = false
              const moved = await step()
              if (!moved && !again) break
            }
          } catch (error) {
            console.warn('[workspace-manager] reorder failed:', error)
          } finally {
            pumping = false
          }
        }

        const schedule = (delay = 150) => {
          if (timer !== undefined) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = undefined
            void pump()
          }, delay)
        }

        ctx.effect(
          () => () => {
            if (timer !== undefined) clearTimeout(timer)
          },
          'workspace-manager: settle',
        )

        ctx.effect(() => {
          const offWorkspaces = ctx.workspaces.list.subscribe(() => schedule())
          const offSessions = ctx.sessions.list.subscribe(() => schedule())
          let offStatus
          try {
            if (ctx.remote && typeof ctx.remote.$on === 'function') {
              offStatus = ctx.remote.$on('api-session/status', (sessionId, isRunning) => {
                runningMap.set(sessionId, isRunning === true)
                schedule()
              })
            }
          } catch {
            /* the status channel is optional; the list baseline still works */
          }
          const offPrefs = prefs.subscribe(() => schedule(0))
          schedule(0)
          return () => {
            offWorkspaces()
            offSessions()
            offPrefs()
            if (typeof offStatus === 'function') offStatus()
          }
        }, 'workspace-manager: reconcile')

        // ---------------------------------------------------- pin markers
        // Official sidebar rows mark pinned *sessions* only; pinned workspaces
        // would be invisible outside the panel. Workspace rows carry a stable
        // hook — `data-row-key="workspace:<id>"` on the project row (Ungrouped
        // has no id and affects no one) — so a tiny badge span is inserted into
        // the real official row, ahead of its action buttons. React may rebuild
        // rows at any time: the MutationObserver re-syncs idempotently (badge
        // state is a pure function of prefs ∩ current rows), so a pass that
        // changes nothing also stops the event loop.
        const PIN_BADGE_ATTR = 'data-wsm-pin-badge'
        function syncPinnedBadges() {
          const pinned = prefs.get().pinned
          if (!Array.isArray(pinned) || pinned.length === 0) {
            document.querySelectorAll(`[${PIN_BADGE_ATTR}]`).forEach((badge) => badge.remove())
            return
          }
          const pinnedSet = new Set(pinned)
          const rows = document.querySelectorAll('[data-row-key^="workspace:"]')
          for (const row of rows) {
            const id = row.getAttribute('data-row-key').slice('workspace:'.length)
            const wanted = pinnedSet.has(id)
            const existing = row.querySelector(`[${PIN_BADGE_ATTR}]`)
            if (wanted && !existing) {
              // A real button, not a decorative badge: the pin in the sidebar
              // toggles the pin itself, so unpinning never requires opening the
              // manager panel. It is inserted ahead of the official action
              // group, so on hover it shifts aside and lines up with the two
              // official buttons instead of covering them.
              const badge = document.createElement('button')
              badge.type = 'button'
              badge.setAttribute(PIN_BADGE_ATTR, '')
              badge.className = 'wsm-sidebar-pin'
              badge.title = t()('unpin')
              badge.setAttribute('aria-label', t()('unpin'))
              badge.innerHTML =
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h6v7l1 1 1-1v-7h6v-2c-1.66 0-3-1.34-3-3z"/></svg>'
              // The official project row is a div with onClick (expand/collapse)
              // and may itself be draggable. The pin press must not bubble: no
              // expand, no row drag starting under the pointer.
              const swallow = (event) => event.stopPropagation()
              badge.addEventListener('pointerdown', swallow)
              badge.addEventListener('mousedown', swallow)
              badge.addEventListener('click', (event) => {
                event.preventDefault()
                event.stopPropagation()
                togglePin(id)
              })
              const actions = row.querySelector('[class*="rowActions"]')
              if (actions && actions.parentElement === row) row.insertBefore(badge, actions)
              else row.appendChild(badge)
            } else if (!wanted && existing) {
              existing.remove()
            }
          }
        }

        ctx.effect(() => {
          let timer
          const schedule = (delay) => {
            if (timer !== undefined) return
            timer = setTimeout(() => {
              timer = undefined
              try {
                syncPinnedBadges()
              } catch {
                /* the official DOM can be mid-flight; the next pass recovers */
              }
            }, delay)
          }
          const observer = new MutationObserver(() => schedule(120))
          observer.observe(document.body, { childList: true, subtree: true })
          const offPrefs = prefs.subscribe(() => schedule(0))
          const offWorkspaces = ctx.workspaces.list.subscribe(() => schedule(0))
          schedule(0)
          return () => {
            observer.disconnect()
            if (timer !== undefined) clearTimeout(timer)
            document.querySelectorAll(`[${PIN_BADGE_ATTR}]`).forEach((badge) => badge.remove())
            offPrefs()
            offWorkspaces()
          }
        }, 'workspace-manager: pin badges')

        ctx.effect(() => ctx.locale.register(NS, DICT), 'workspace-manager: locale')

        const t = () => ctx.locale.bind(NS)

        // 最长标题的像素宽度：面板默认宽度据此决定，让名字整行显示。
        // 用 canvas 量而不是往 DOM 里插节点——开面板时不能有可见的重排。
        function measureTitleWidth(titles) {
          if (typeof document === 'undefined') return 0
          const context = document.createElement('canvas').getContext?.('2d')
          if (!context) return 0
          const sample = document.querySelector('.wsm-row-title')
          const style = sample ? getComputedStyle(sample) : null
          context.font = style
            ? `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            : '12.5px sans-serif'
          let widest = 0
          for (const title of titles) widest = Math.max(widest, context.measureText(title).width)
          return widest
        }

        // ---------------------------------------------------------- launcher
        // The button is a plain DOM node in the official header row (React
        // rebuilds that row at will, so the sync pass re-inserts it). It lives
        // between the section title and the search field because that is where
        // the shipped layout keeps free space: the search slot owns the
        // free-space margin, and the button takes that margin over while it is
        // mounted. Animations, scrolling and the dock's own shift therefore
        // carry the button along with the official controls — no coordinates.
        let launcherNode = null
        let launcherSlot = null
        let launcherSuppressedWidth = -1
        let launcherRemeasure = false
        let launcherTimer
        let launcherHeader = null
        let launcherResizer = null
        let launcherClassObserver = null
        let launcherPaintKey = ''

        function removeLauncher() {
          if (launcherSlot) {
            launcherSlot.style.marginLeft = ''
            launcherSlot = null
          }
          if (launcherNode) {
            launcherNode.remove()
            launcherNode = null
          }
          launcherPaintKey = ''
        }

        function paintLauncher() {
          if (!launcherNode) return
          const open = panel.get().open === true
          const label = t()(open ? 'close' : 'open')
          const key = `${open}|${label}`
          if (key === launcherPaintKey) return
          launcherPaintKey = key
          launcherNode.dataset.active = open ? 'true' : 'false'
          launcherNode.setAttribute('aria-expanded', open ? 'true' : 'false')
          launcherNode.setAttribute('aria-label', label)
          launcherNode.title = label
        }

        function createLauncherNode() {
          const node = document.createElement('button')
          node.type = 'button'
          node.setAttribute(LAUNCHER_ATTR, '')
          node.className = 'wsm-launcher'
          node.innerHTML = MANAGE_ICON_SVG
          // The row itself handles presses; the button's must not reach it.
          const swallow = (event) => event.stopPropagation()
          node.addEventListener('pointerdown', swallow)
          node.addEventListener('mousedown', swallow)
          node.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (panel.get().open) {
              panel.set({ open: false })
              return
            }
            const rect = node.getBoundingClientRect()
            panel.set({
              open: true,
              anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            })
          })
          return node
        }

        function watchLauncherHeader(header) {
          if (launcherHeader === header) return
          launcherResizer?.disconnect()
          launcherClassObserver?.disconnect()
          launcherHeader = header
          // Expanding the search replaces the row's shape (searchSlotExpanded /
          // headerActionsHidden) through class names only — no childList
          // mutation, so the row is watched directly.
          launcherClassObserver = new MutationObserver(() => scheduleLauncher(0))
          launcherClassObserver.observe(header, {
            attributes: true,
            subtree: true,
            attributeFilter: ['class'],
          })
          if (typeof ResizeObserver !== 'function') return
          launcherResizer = new ResizeObserver(() => {
            launcherSuppressedWidth = -1
            launcherRemeasure = true
            scheduleLauncher(0)
          })
          launcherResizer.observe(header)
        }

        // The header clips (`overflow:hidden`): the third control only fits
        // while there is spare room, and when it does not, the row is left
        // exactly as shipped. The fit is measured after inserting (see below).
        function syncLauncher() {
          const header = document.querySelector('[class*="sectionHeader"]')
          const slot = header?.querySelector('[class*="searchSlot"]')
          if (!header || !slot || header.clientWidth <= 0) {
            removeLauncher()
            return
          }
          watchLauncherHeader(header)
          // Searching replaces the whole row; the rail layout has no title gap.
          if (header.querySelector('[class*="searchSlotExpanded"]')) {
            removeLauncher()
            return
          }
          if (launcherSuppressedWidth >= 0 && launcherSuppressedWidth === header.clientWidth) {
            removeLauncher()
            return
          }
          // Already in place: only the state label can have changed. Re-checking
          // the fit here would force a synchronous layout on every mutation of
          // the page (the panel's own row list included) — so it is only redone
          // when the column width actually changed.
          const attached =
            launcherNode !== null && launcherNode.parentElement === header && launcherNode.nextSibling === slot
          if (attached && !launcherRemeasure) {
            paintLauncher()
            return
          }
          if (!attached) {
            if (!launcherNode) launcherNode = createLauncherNode()
            // React may drop the node or reorder the row at any time.
            header.insertBefore(launcherNode, slot)
            launcherSlot = slot
            slot.style.marginLeft = '0'
          }
          launcherSuppressedWidth = -1
          launcherRemeasure = false
          paintLauncher()
          // `overflow:hidden` + `justify-content:flex-end` means content too
          // wide is clipped on the LEFT and `scrollWidth` never grows, so the
          // squeeze is measured instead: the search slot shrinks below its 28px
          // cap first, then the section label is pushed out of the row.
          const headerRect = header.getBoundingClientRect()
          const slotRect = slot.getBoundingClientRect()
          const label = header.querySelector('[class*="sectionLabel"]')
          const labelRect = label?.getBoundingClientRect()
          const squeezed =
            slotRect.width < 27 ||
            (labelRect !== undefined && labelRect.width > 0 && labelRect.left < headerRect.left - 0.5)
          if (squeezed) {
            launcherSuppressedWidth = header.clientWidth
            removeLauncher()
          }
        }

        function scheduleLauncher(delay) {
          if (launcherTimer !== undefined) return
          launcherTimer = setTimeout(() => {
            launcherTimer = undefined
            try {
              syncLauncher()
            } catch {
              /* the official DOM can be mid-flight; the next pass recovers */
            }
          }, delay)
        }

        // ------------------------------------------------------------ surface
        function useTranslate() {
          const [, setTick] = React.useState(0)
          React.useEffect(() => ctx.locale.subscribe(() => setTick((n) => n + 1)), [])
          return t()
        }

        // Inline dialog replacing the workspace row. One box covers both
        // scenarios: with the registered directory present the "move folder"
        // toggle defaults on; if the directory is gone the toggle is disabled
        // and the dialog degrades to binding the workspace to another folder.
        function RelocateDialog({ workspace, runningCount, busy, onExecute, onCancel }) {
          const tr = useTranslate()
          const title = workspace.title || workspace.path
          const [probeData, setProbeData] = React.useState(undefined)
          // 开箱即改：预填当前路径，改名/换父目录都只动要变的那一段。
          const [path, setPath] = React.useState(workspace.path)
          const [moveOn, setMoveOn] = React.useState(true)
          const [carryOn, setCarryOn] = React.useState(true)

          React.useEffect(() => {
            let alive = true
            ;(async () => {
              try {
                const data = await apiProbe(workspace.workspaceId)
                if (alive) setProbeData({ ...data })
              } catch (error) {
                if (alive) setProbeData({ ok: false, message: error instanceof Error ? error.message : String(error) })
              }
            })()
            return () => {
              alive = false
            }
          }, [workspace.workspaceId])

          const probeOk = probeData?.ok === true
          const dead = probeOk && probeData.dirExists === false
          const moving = probeOk && !dead && moveOn === true
          const sessionCount = probeOk ? probeData.sessionCount ?? 0 : 0

          // Defaults land once the probe answers: move on (dir exists),
          // carry on (there is something to carry). The prefilled path snaps
          // to the probe's realpath only when the user hasn't edited it yet.
          React.useEffect(() => {
            if (!probeOk) return
            setMoveOn(probeData.dirExists === true)
            setCarryOn((probeData.sessionCount ?? 0) > 0)
            if (typeof probeData.path === 'string' && probeData.path.length > 0) {
              setPath((current) => (current === workspace.path ? probeData.path : current))
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [probeOk, probeData?.dirExists, probeData?.sessionCount, probeData?.path])

          const canExecute = probeOk && path.trim().length > 0
          const execute = () => {
            if (!canExecute) return
            onExecute({
              targetPath: path.trim(),
              moveDir: moving,
              carry: carryOn,
            })
          }

          const toggle = (label, checked, disabled, onToggle, note) =>
            h(
              'div',
              { className: 'wsm-repath-toggle' },
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  className: 'wsm-switch-row',
                  'aria-checked': checked ? 'true' : 'false',
                  disabled,
                  onClick: onToggle,
                },
                h('span', { className: 'wsm-switch', 'data-on': checked ? 'true' : undefined }, h('span', { className: 'wsm-switch-thumb' })),
                h('span', { className: 'wsm-switch-label' }, label),
              ),
              note ? h('div', { className: 'wsm-repath-note' }, note) : null,
            )

          return h(
            'div',
            { key: workspace.workspaceId, className: 'wsm-repath' },
            h('div', { className: 'wsm-confirm-title' }, tr(dead ? 'repathDeadTitle' : 'repathTitle', { name: title })),
            h('div', { className: 'wsm-repath-current' }, `${tr('repathFrom')}${probeOk ? probeData.path : workspace.path}`),
            h('label', { className: 'wsm-repath-label' }, tr('repathToLabel')),
            h('input', {
              type: 'text',
              className: 'wsm-repath-input',
              placeholder: tr('repathToPlaceholder'),
              value: path,
              autoFocus: true,
              spellCheck: false,
              onChange: (event) => setPath(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && canExecute && !busy) {
                  event.preventDefault()
                  execute()
                }
              },
            }),
            !probeOk
              ? h(
                  'div',
                  { className: 'wsm-repath-note' },
                  probeData === undefined
                    ? '…'
                    : tr('repathProbeFailed', { message: probeData.message ?? '' }),
                )
              : null,
            toggle(
              tr('repathMove'),
              probeOk ? moving : moveOn,
              dead,
              () => setMoveOn((value) => !value),
              dead ? tr('repathMoveDeadNote') : moving ? null : tr('repathNoMoveNote'),
            ),
            runningCount > 0
              ? h('div', { className: 'wsm-confirm-warn' }, tr('repathRunningWarn', { n: runningCount }))
              : null,
            toggle(
              tr('repathCarry'),
              probeOk ? carryOn && sessionCount > 0 : carryOn,
              !probeOk || sessionCount === 0,
              () => setCarryOn((value) => !value),
              sessionCount === 0 ? tr('repathCarryNone') : null,
            ),
            h(
              'div',
              { className: 'wsm-repath-actions' },
              h(
                'button',
                { type: 'button', className: 'wsm-btn', disabled: busy, onClick: onCancel },
                tr('cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wsm-btn wsm-btn-danger',
                  disabled: busy || !canExecute,
                  onClick: execute,
                },
                tr('repathExecute'),
              ),
            ),
          )
        }

        function togglePin(workspaceId) {
          const current = prefs.get()
          const pinned = current.pinned.includes(workspaceId)
            ? current.pinned.filter((id) => id !== workspaceId)
            : [...current.pinned, workspaceId]
          prefs.set({ ...current, pinned })
        }

        function Panel() {
          const tr = useTranslate()
          const workspaces = useSnapshot(ctx.workspaces.list)
          const sessions = useSnapshot(ctx.sessions.list)
          const state = useStore(prefs)
          const shell = useStore(panel)
          const [confirm, setConfirm] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [error, setError] = React.useState(null)
          // Initial position uses the rectangle captured at click time; the
          // frame loop below then follows the live button.
          const [pos, setPos] = React.useState(() => measure(shell.anchor))
          const [drag, setDrag] = React.useState(null)
          const [settle, setSettle] = React.useState(null)
          const [localOrder, setLocalOrder] = React.useState(null)
          const [reloc, setReloc] = React.useState(null)
          const [relocResult, setRelocResult] = React.useState(null)
          // Filter box at the top: the rows below narrow on every keystroke.
          const [filter, setFilter] = React.useState('')
          // Host capability: opening a folder needs the desktop opener. The
          // button only appears once the Host confirms it, so a headless host
          // never shows a control that cannot work.
          const [canOpenPath, setCanOpenPath] = React.useState(false)
          // Width: a dragged width wins; otherwise the panel sizes itself to the
          // longest workspace name once, at open time.
          const [autoWidth, setAutoWidth] = React.useState(null)
          const widthRef = React.useRef(null)
          const cardRef = React.useRef(null)
          const resizingRef = React.useRef(false)
          const dragRef = React.useRef(null)
          const pointerY = React.useRef(0)
          const settleTimer = React.useRef(undefined)
          const listRef = React.useRef(null)
          const stopDragRef = React.useRef(null)

          React.useEffect(
            () => () => {
              stopDragRef.current?.()
              if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
            },
            [],
          )

          React.useEffect(() => {
            let live = true
            apiCapabilities()
              .then((body) => {
                if (live) setCanOpenPath(body.canOpenPath === true)
              })
              .catch(() => {
                /* Host half absent: keep the row actions it can serve. */
              })
            return () => {
              live = false
            }
          }, [])

          // Width source of truth for the frame loop. Kept out of the render
          // path: a render during the drag (setPos comes from the loop) must not
          // snap the width back to the stored value mid-gesture.
          React.useEffect(() => {
            widthRef.current = state.panelWidth ?? autoWidth
          }, [state.panelWidth, autoWidth])

          React.useEffect(() => {
            if (state.panelWidth !== null) return
            const titles = workspaces.items.map((workspace) => workspace.title || workspace.path || '')
            setAutoWidth(Math.max(0, measureTitleWidth(titles)))
          }, [])

          // The card hangs off the launcher button, and the launcher is a
          // normal child of the sidebar header: it slides when the dock is
          // scrolled, resized or collapsed. Tracking its rectangle every frame
          // keeps the card attached instead of frozen at the click position.
          React.useEffect(() => {
            let frame
            let last = ''
            const track = () => {
              if (resizingRef.current) {
                frame = requestAnimationFrame(track)
                return
              }
              const node = document.querySelector(`[${LAUNCHER_ATTR}]`)
              const rect = node?.getBoundingClientRect()
              const captured = panel.get().anchor
              const next = measure(
                rect && rect.width > 0
                  ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
                  : captured,
                widthRef.current ?? undefined,
              )
              const key = `${next.left}|${next.top}|${next.width}|${next.maxHeight}`
              if (key !== last) {
                last = key
                setPos(next)
              }
              frame = requestAnimationFrame(track)
            }
            frame = requestAnimationFrame(track)
            return () => cancelAnimationFrame(frame)
          }, [])

          React.useEffect(() => {
            // No backdrop: a full-screen layer would cover the header button and
            // take the toggle away. The first press outside the card closes the
            // popover and is swallowed — pointerdown is cancelled so the
            // compatibility click cannot reach the row underneath; the click
            // listener is a second guard for engines that still deliver it.
            const swallow = (event) => {
              event.preventDefault()
              event.stopPropagation()
            }
            let cleanupClick
            const onPointerDown = (event) => {
              const target = event.target
              if (target instanceof Element) {
                if (target.closest('.wsm-card') || target.closest(`[${LAUNCHER_ATTR}]`)) return
              }
              event.preventDefault()
              event.stopPropagation()
              panel.set({ open: false })
              document.addEventListener('click', swallow, { capture: true, once: true })
              cleanupClick = setTimeout(
                () => document.removeEventListener('click', swallow, true),
                400,
              )
            }
            const onKey = (event) => {
              // Typing a path: Escape belongs to the dialog (Exit removes focus from input).
              if (event.key === 'Escape' && event.target instanceof HTMLInputElement) return
              if (event.key === 'Escape' && dragRef.current === null) panel.set({ open: false })
            }
            document.addEventListener('pointerdown', onPointerDown, true)
            window.addEventListener('keydown', onKey)
            return () => {
              document.removeEventListener('pointerdown', onPointerDown, true)
              document.removeEventListener('click', swallow, true)
              if (cleanupClick !== undefined) clearTimeout(cleanupClick)
              window.removeEventListener('keydown', onKey)
            }
          }, [])

          const items = workspaces.items
          const byId = sessions.byId
          const activeId = activeWorkspaceId(items, byId)
          const emptyIds = items.filter((w) => w.sessionIds.length === 0).map((w) => w.workspaceId)
          const itemsById = new Map(items.map((w) => [w.workspaceId, w]))
          // The committed order is applied optimistically while the Host writes
          // land, so the rows do not fall back to the old order between awaits.
          const rawItems = localOrder
            ? localOrder.map((id) => itemsById.get(id)).filter(Boolean)
            : items
          // Live filter: case-insensitive substring over the row label only
          // (title, falling back to the path when title is empty). Matching the
          // full path is actively harmful: sibling workspaces under one parent
          // share the whole prefix, so any fragment matches them all.
          const query = filter.trim().toLowerCase()
          const rowsItems = query
            ? rawItems.filter((w) => (w.title || w.path || '').toLowerCase().includes(query))
            : rawItems

          // Drag the right edge: the pointer x is all that matters; the frame
          // loop picks the new width up from widthRef and the card follows.
          const beginResize = (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return
            // No preventDefault: it would suppress the compatibility click and
            // with it the double-click that resets the width. Text selection is
            // blocked during the gesture instead.
            event.stopPropagation()
            event.currentTarget.setPointerCapture?.(event.pointerId)
            const previousSelect = document.body.style.userSelect
            document.body.style.userSelect = 'none'
            const startX = event.clientX
            const startWidth = pos.width
            let next = startWidth
            let lastPos = pos
            resizingRef.current = true
            const move = (moveEvent) => {
              next = clampPanelWidth(startWidth + (moveEvent.clientX - startX), window.innerWidth)
              widthRef.current = next
              // Write the card directly: a React render per pointer move would
              // rebuild every row for nothing.
              lastPos = measure(panel.get().anchor, next)
              if (cardRef.current) {
                cardRef.current.style.width = `${lastPos.width}px`
                cardRef.current.style.left = `${lastPos.left}px`
              }
            }
            const finish = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', finish)
              window.removeEventListener('pointercancel', finish)
              resizingRef.current = false
              document.body.style.userSelect = previousSelect
              setPos(lastPos)
              prefs.set({ ...prefs.get(), panelWidth: next })
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', finish)
            window.addEventListener('pointercancel', finish)
          }

          const resetWidth = () => {
            prefs.set({ ...prefs.get(), panelWidth: null })
            widthRef.current = null
          }

          const run = async (operation) => {
            if (busy) return
            setBusy(true)
            setError(null)
            try {
              await operation()
              setConfirm(null)
            } catch (reason) {
              setError(tr('failed', { message: reason instanceof Error ? reason.message : String(reason) }))
            } finally {
              setBusy(false)
            }
          }

          const move = (workspaceId, direction) =>
            run(async () => {
              const order = ctx.workspaces.list.getSnapshot().items.map((w) => w.workspaceId)
              const index = order.indexOf(workspaceId)
              if (direction === 'up') {
                if (index > 0) await ctx.workspaces.insertBefore(workspaceId, order[index - 1])
              } else if (index >= 0 && index < order.length - 1) {
                await ctx.workspaces.insertBefore(workspaceId, order[index + 2])
              }
            })

          const remove = (workspaceId) => run(() => ctx.workspaces.delete(workspaceId))

          // Relocate: open the inline dialog; the probe result drives whether
          // "move the folder too" is offered (the folder still exists) or the
          // dialog degrades to a plain rebind (registered directory is gone).
          const openRelocate = (workspaceId) => {
            setRelocResult(null)
            setReloc({ id: workspaceId })
          }

          const executeRelocate = (workspaceId, payload) =>
            run(async () => {
              const result = await apiRelocate({
                workspaceId,
                ...payload,
                confirm: true,
              })
              if (!result.ok) {
                const reason = new Error(result.hint ? `${result.message}\n${result.hint}` : result.message)
                throw reason
              }
              setReloc(null)
              // The workspace id changed with the record; keep the pin state
              // attached to the workspace, not to a stale id.
              const current = prefs.get()
              if (current.pinned.includes(workspaceId) && typeof result.newWorkspaceId === 'string') {
                prefs.set({
                  ...current,
                  pinned: current.pinned.map((id) => (id === workspaceId ? result.newWorkspaceId : id)),
                })
              }
              setRelocResult(result)
            })

          // Drag-to-reorder from the left grip (pointer events, ported from
          // dsh-rundeck): the dragged row follows the pointer, the other rows
          // translate with a transition to open the target slot, and the drop
          // index is resolved from the measured row heights every frame.
          const beginDrag = (event, index) => {
            if (busy || confirm || reloc || dragRef.current || query) return
            if (event.pointerType === 'mouse' && event.button !== 0) return
            const list = listRef.current
            if (!list) return
            const nodes = Array.from(list.querySelectorAll('[data-wsm-row]'))
            if (nodes.length === 0 || nodes.length !== rowsItems.length) return

            // A settle animation may still be translating a row; clear it before
            // measuring so its transformed rect cannot skew the geometry.
            if (settle) {
              const settlingNode = nodes.find(
                (node) => node.getAttribute('data-wsm-id') === settle.id,
              )
              if (settlingNode) {
                settlingNode.style.transition = 'none'
                settlingNode.style.transform = ''
                void settlingNode.getBoundingClientRect()
                settlingNode.style.transition = ''
              }
            }
            const listRect = list.getBoundingClientRect()
            const rects = nodes.map((node) => node.getBoundingClientRect())
            const heights = rects.map((rect) => rect.height)
            const tops = rects.map((rect) => rect.top - listRect.top + list.scrollTop)
            const gap = heights.length > 1
              ? Math.max(0, (tops[1] ?? 0) - (tops[0] ?? 0) - (heights[0] ?? 0))
              : 0
            const top = tops[index] ?? 0
            const height = heights[index] ?? 0
            const lastTop = tops[heights.length - 1] ?? 0
            const lastHeight = heights[heights.length - 1] ?? 0
            const startY = event.clientY - listRect.top + list.scrollTop
            const grip = event.currentTarget
            const pointerId = event.pointerId
            const previousUserSelect = document.body.style.userSelect
            const previousCursor = document.body.style.cursor

            event.preventDefault()
            try {
              grip.setPointerCapture(pointerId)
            } catch {
              /* capture is an optimisation; window listeners still work */
            }

            pointerY.current = event.clientY
            const initial = {
              id: rowsItems[index].workspaceId,
              from: index,
              pointerId,
              startY,
              dy: 0,
              to: index,
              offsets: previewOffsets(heights, gap, index, index),
              heights,
              gap,
              min: -top,
              // +1px lets the last slot be reachable: at the exact bottom the
              // dragged center ties the last row's center, and the strict
              // "center below" test would otherwise keep it one slot short.
              max: lastTop + lastHeight - (top + height) + 1,
            }
            dragRef.current = initial
            if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
            settleTimer.current = undefined
            setSettle(null)
            setLocalOrder(null)
            setDrag(initial)
            pointerDragging = true
            document.body.style.userSelect = 'none'
            document.body.style.cursor = 'grabbing'

            let frame
            const cleanup = () => {
              stopDragRef.current = null
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              window.removeEventListener('pointercancel', onCancel)
              window.removeEventListener('keydown', onKeyDown)
              if (frame !== undefined) cancelAnimationFrame(frame)
              frame = undefined
              document.body.style.userSelect = previousUserSelect
              document.body.style.cursor = previousCursor
              try {
                grip.releasePointerCapture(pointerId)
              } catch {
                /* capture may already be gone */
              }
            }

            const syncDrag = () => {
              const current = dragRef.current
              if (!current) return
              const box = listRef.current
              if (!box) return
              const boxRect = box.getBoundingClientRect()
              const contentY = pointerY.current - boxRect.top + box.scrollTop
              const dy = Math.min(current.max, Math.max(current.min, contentY - current.startY))
              const to = dropIndexFor(current.heights, current.gap, current.from, dy)
              if (dy === current.dy && to === current.to) return
              const next = {
                ...current,
                dy,
                to,
                offsets:
                  to === current.to
                    ? current.offsets
                    : previewOffsets(current.heights, current.gap, current.from, to),
              }
              dragRef.current = next
              setDrag(next)
            }

            const tick = () => {
              frame = undefined
              if (!dragRef.current) return
              const box = listRef.current
              if (box) {
                const rect = box.getBoundingClientRect()
                const speed = 10
                if (pointerY.current < rect.top + 26) {
                  box.scrollTop = Math.max(0, box.scrollTop - speed)
                } else if (pointerY.current > rect.bottom - 26) {
                  const max = Math.max(0, box.scrollHeight - box.clientHeight)
                  box.scrollTop = Math.min(max, box.scrollTop + speed)
                }
                syncDrag()
              }
              frame = requestAnimationFrame(tick)
            }

            const onMove = (moveEvent) => {
              const current = dragRef.current
              if (!current || moveEvent.pointerId !== current.pointerId) return
              pointerY.current = moveEvent.clientY
              if (moveEvent.cancelable) moveEvent.preventDefault()
              syncDrag()
            }

            const finish = (commit) => {
              const current = dragRef.current
              if (!current) return
              cleanup()
              dragRef.current = null
              // Recompute on release: the pointer may have moved in the last frame.
              let dy = current.dy
              let to = current.to
              const box = listRef.current
              if (commit && box) {
                const boxRect = box.getBoundingClientRect()
                const contentY = pointerY.current - boxRect.top + box.scrollTop
                dy = Math.min(current.max, Math.max(current.min, contentY - current.startY))
                to = dropIndexFor(current.heights, current.gap, current.from, dy)
              }
              setDrag(null)
              if (!commit || to === current.from) {
                pointerDragging = false
                schedule(0)
                return
              }

              const desired = moveInOrder(rowsItems.map((workspace) => workspace.workspaceId), current.from, to)
              const offsets = previewOffsets(current.heights, current.gap, current.from, to)
              // Reorder the DOM now and compensate the dragged row's layout jump;
              // the next frame slides that compensation to zero (FLIP).
              setLocalOrder(desired)
              setSettle({ id: current.id, dy: dy - (offsets[current.from] ?? 0) })
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  setSettle((value) => (value === null ? value : { ...value, dy: 0 }))
                })
              })
              if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
              settleTimer.current = setTimeout(() => setSettle(null), 240)

              void run(async () => {
                try {
                  await applyOrder(desired)
                } finally {
                  setLocalOrder(null)
                  pointerDragging = false
                  schedule(0)
                }
              })
            }

            const onUp = (upEvent) => {
              const current = dragRef.current
              if (!current || upEvent.pointerId !== current.pointerId) return
              pointerY.current = upEvent.clientY
              finish(true)
            }

            const onCancel = () => finish(false)

            const onKeyDown = (keyEvent) => {
              if (keyEvent.key !== 'Escape') return
              keyEvent.preventDefault()
              finish(false)
            }

            stopDragRef.current = () => finish(false)
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
            window.addEventListener('pointercancel', onCancel)
            window.addEventListener('keydown', onKeyDown)
            frame = requestAnimationFrame(tick)
          }

          const cleanEmpty = () => run(async () => {
            for (const id of confirm.ids) await ctx.workspaces.delete(id)
          })

          const rows = rowsItems.map((workspace, index) => {
            const count = workspace.sessionIds.length
            const runningCount = workspace.sessionIds.filter((id) => sessionRunning(id, sessions)).length
            const pinned = state.pinned.includes(workspace.workspaceId)
            const title = workspace.title || workspace.path

            if (reloc?.id === workspace.workspaceId) {
              return h(RelocateDialog, {
                key: workspace.workspaceId,
                workspace,
                runningCount,
                busy,
                onExecute: (payload) => executeRelocate(workspace.workspaceId, payload),
                onCancel: () => setReloc(null),
              })
            }

            if (confirm?.kind === 'delete' && confirm.id === workspace.workspaceId) {
              return h(
                'div',
                { key: workspace.workspaceId, className: 'wsm-confirm' },
                h('div', { className: 'wsm-confirm-title' }, tr('removeTitle', { name: title })),
                h('div', { className: 'wsm-confirm-body' }, tr('removeBody', { n: count })),
                runningCount > 0
                  ? h('div', { className: 'wsm-confirm-warn' }, tr('removeRunning', { n: runningCount }))
                  : null,
                h(
                  'div',
                  { className: 'wsm-confirm-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'wsm-btn', disabled: busy, onClick: () => setConfirm(null) },
                    tr('cancel'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wsm-btn wsm-btn-danger',
                      disabled: busy,
                      onClick: () => remove(workspace.workspaceId),
                    },
                    tr('remove'),
                  ),
                ),
              )
            }

            const meta = runningCount > 0
              ? `${tr('sessions', { n: count })} · ${tr('running', { n: runningCount })}`
              : tr('sessions', { n: count })

            const dragging = drag?.id === workspace.workspaceId
            const settling = settle?.id === workspace.workspaceId
            const transform = dragging
              ? `translateY(${drag.dy}px)`
              : drag
                ? `translateY(${drag.offsets[index] ?? 0}px)`
                : settling
                  ? `translateY(${settle.dy}px)`
                  : null
            const rowClass = [
              'wsm-row',
              dragging ? 'wsm-rowDragging' : '',
              drag && !dragging ? 'wsm-rowShift' : '',
              settling ? 'wsm-rowSettle' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return h(
              'div',
              {
                key: workspace.workspaceId,
                className: rowClass,
                'data-wsm-row': 'true',
                'data-wsm-id': workspace.workspaceId,
                'data-active': workspace.workspaceId === activeId ? 'true' : undefined,
                style: transform === null ? undefined : { transform },
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'wsm-grip',
                  title: tr('drag'),
                  'aria-label': tr('drag'),
                  onPointerDown: (event) => beginDrag(event, index),
                  onKeyDown: (event) => {
                    if (dragRef.current) return
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    move(workspace.workspaceId, event.key === 'ArrowUp' ? 'up' : 'down')
                  },
                },
                iconGrip(),
              ),
              h(
                'div',
                { className: 'wsm-row-main' },
                h('div', { className: 'wsm-row-title', title: workspace.path }, title),
                h('div', { className: 'wsm-row-meta' }, meta),
              ),
              h(
                'div',
                { className: 'wsm-row-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wsm-icon wsm-pin',
                    'data-on': pinned ? 'true' : undefined,
                    title: pinned ? tr('unpin') : tr('pin'),
                    'aria-label': pinned ? tr('unpin') : tr('pin'),
                    'aria-pressed': pinned,
                    onClick: () => togglePin(workspace.workspaceId),
                  },
                  iconPin(pinned),
                ),
                canOpenPath
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'wsm-icon wsm-reveal',
                        title: tr('openFolder'),
                        'aria-label': tr('openFolder'),
                        disabled: busy,
                        onClick: () => run(() => apiOpenFolder(workspace.workspaceId)),
                      },
                      iconFolder(),
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wsm-icon wsm-repath-icon wsm-reveal',
                    title: tr('repath'),
                    'aria-label': tr('repath'),
                    disabled: busy,
                    onClick: () => openRelocate(workspace.workspaceId),
                  },
                  iconRepath(),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wsm-icon wsm-danger wsm-reveal',
                    title: tr('remove'),
                    'aria-label': tr('remove'),
                    disabled: busy,
                    onClick: () => setConfirm({ kind: 'delete', id: workspace.workspaceId }),
                  },
                  iconTrash(),
                ),
              ),
            )
          })

          return h(
            'div',
            {
              className: 'wsm-card',
              ref: cardRef,
              style: { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight },
              onMouseDown: (event) => event.stopPropagation(),
            },
            h(
              'div',
              { className: 'wsm-head' },
              h('span', { className: 'wsm-title' }, tr('title')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wsm-close',
                  title: tr('close'),
                  'aria-label': tr('close'),
                  onClick: () => panel.set({ open: false }),
                },
                '×',
              ),
            ),
            h(
              'div',
              { className: 'wsm-filterbar' },
              h('input', {
                type: 'text',
                className: 'wsm-filter',
                placeholder: tr('filterPlaceholder'),
                value: filter,
                spellCheck: false,
                onChange: (event) => setFilter(event.target.value),
                onKeyDown: (event) => {
                  // Escape in the filter clears it first; an empty filter lets
                  // Escape keep its usual meaning (the window handler ignores
                  // input targets, so the panel stays open).
                  if (event.key === 'Escape' && filter) {
                    event.preventDefault()
                    setFilter('')
                  }
                },
              }),
            ),
            h(
              'div',
              { className: 'wsm-toolbar' },
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  className: 'wsm-switch-row',
                  'aria-checked': state.autoRise ? 'true' : 'false',
                  title: tr('autoRiseHint'),
                  onClick: () => prefs.set({ ...state, autoRise: !state.autoRise }),
                },
                h(
                  'span',
                  { className: 'wsm-switch', 'data-on': state.autoRise ? 'true' : undefined },
                  h('span', { className: 'wsm-switch-thumb' }),
                ),
                h('span', { className: 'wsm-switch-label' }, tr('autoRise')),
              ),
              h('span', { className: 'wsm-spacer' }),
              h(
                'button',
                { type: 'button', className: 'wsm-btn', disabled: busy, onClick: () => run(() => sortNow()) },
                tr('sortNow'),
              ),
            ),
            h(
              'div',
              { className: 'wsm-list', ref: listRef },
              items.length === 0
                ? h('div', { className: 'wsm-empty' }, tr('none'))
                : rows.length === 0
                  ? h('div', { className: 'wsm-empty' }, tr('noMatch'))
                  : rows,
            ),
            confirm?.kind === 'clean'
              ? h(
                  'div',
                  { className: 'wsm-clean' },
                  h('div', { className: 'wsm-confirm-title' }, tr('cleanTitle', { n: confirm.ids.length })),
                  h('div', { className: 'wsm-confirm-body' }, tr('cleanBody')),
                  h(
                    'div',
                    { className: 'wsm-confirm-actions' },
                    h(
                      'button',
                      { type: 'button', className: 'wsm-btn', disabled: busy, onClick: () => setConfirm(null) },
                      tr('cancel'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'wsm-btn wsm-btn-danger',
                        disabled: busy,
                        onClick: () => cleanEmpty(),
                      },
                      tr('remove'),
                    ),
                  ),
                )
              : null,
            relocResult
              ? h(
                  'div',
                  { className: 'wsm-clean' },
                  h('div', { className: 'wsm-confirm-title' }, tr('repathResultTitle')),
                  h('div', { className: 'wsm-repath-current' }, `${relocResult.from} → ${relocResult.to}`),
                  h(
                    'div',
                    { className: 'wsm-repath-note' },
                    relocResult.moved === 'rename'
                      ? tr('repathMovedRename')
                      : relocResult.moved === 'copy'
                        ? tr('repathMovedCopy')
                        : tr('repathNotMoved'),
                  ),
                  relocResult.attached.length > 0
                    ? h('div', { className: 'wsm-repath-note' }, tr('repathAttached', { n: relocResult.attached.length }))
                    : null,
                  relocResult.carried.length > 0
                    ? h('div', { className: 'wsm-repath-note' }, tr('repathCarried', { n: relocResult.carried.length }))
                    : null,
                  relocResult.createdPlainSessionId
                    ? h('div', { className: 'wsm-repath-note' }, tr('repathPlainCreated'))
                    : null,
                  relocResult.archived > 0
                    ? h('div', { className: 'wsm-repath-note' }, tr('repathArchived', { n: relocResult.archived }))
                    : null,
                  h(
                    'div',
                    { className: 'wsm-repath-note' },
                    relocResult.orderKept ? tr('repathOrderKept') : tr('repathOrderLost'),
                  ),
                  h(
                    'div',
                    { className: 'wsm-confirm-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'wsm-btn',
                        onClick: () => setRelocResult(null),
                      },
                      tr('repathResultOk'),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'wsm-foot' },
              error ? h('div', { className: 'wsm-error' }, error) : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'wsm-btn',
                  disabled: busy || emptyIds.length === 0,
                  onClick: () => setConfirm({ kind: 'clean', ids: emptyIds }),
                },
                tr('cleanEmptyCount', { n: emptyIds.length }),
              ),
            ),
            // Right-edge grip. Double-click returns to the content-based width.
            h('div', {
              className: 'wsm-resize',
              role: 'separator',
              'aria-orientation': 'vertical',
              'aria-label': tr('resizeWidth'),
              title: tr('resizeWidth'),
              onPointerDown: beginResize,
              onDoubleClick: resetWidth,
            }),
          )
        }

        // The popover is the only React surface left in the overlay slot; the
        // launcher lives in the official header (see syncLauncher). Closing on
        // an outside press is done with a listener instead of a full-screen
        // backdrop, so the header button itself stays clickable and toggles.
        function Surface() {
          const open = useStore(panel)
          return open.open ? h(Panel) : null
        }

        ctx.effect(() => {
          const observer = new MutationObserver(() => scheduleLauncher(60))
          observer.observe(document.body, { childList: true, subtree: true })
          const onResize = () => {
            launcherSuppressedWidth = -1
            launcherRemeasure = true
            scheduleLauncher(0)
          }
          window.addEventListener('resize', onResize)
          const offPanel = panel.subscribe(() => scheduleLauncher(0))
          scheduleLauncher(0)
          return () => {
            observer.disconnect()
            window.removeEventListener('resize', onResize)
            if (launcherTimer !== undefined) clearTimeout(launcherTimer)
            offPanel()
            launcherResizer?.disconnect()
            launcherResizer = null
            launcherClassObserver?.disconnect()
            launcherClassObserver = null
            launcherHeader = null
            removeLauncher()
          }
        }, 'workspace-manager: launcher')

        ctx.effect(() => {
          // HMR re-executes this bundle while the document persists: overwrite
          // the tag instead of skipping it, or the page keeps the first CSS.
          const style = document.getElementById(STYLE_ID) ?? document.createElement('style')
          style.id = STYLE_ID
          style.textContent = CSS
          if (!style.isConnected) document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'workspace-manager: styles')

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'workspace-manager',
              order: 60,
            },
            Surface,
          ),
        )
      },
    }
  },
})
