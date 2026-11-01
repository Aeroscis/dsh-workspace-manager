/**
 * Workspace Manager — browser half.
 *
 * Entry point: a launcher button is rendered in the official shell.overlay slot
 * and positioned over the blank space in the official workspaces panel header
 * (the header is width-locked, so nothing is inserted into its DOM). The button
 * opens a manager popover in the same slot.
 *
 * Ordering uses only official Client APIs:
 *   ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)   (Host-persisted order)
 *   ctx.workspaces.delete(workspaceId)                            (removes the registration only)
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
        note: '顺序修改会写入 Host，所有窗口同步。',
        failed: '操作失败：{message}',
        sessions: '{n} 个会话',
        running: '{n} 运行中',
        none: '没有工作区',
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
        note: 'Order changes are written to the Host and shared by every window.',
        failed: 'Operation failed: {message}',
        sessions: '{n} sessions',
        running: '{n} running',
        none: 'No workspaces',
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

    // ---------------------------------------------------------- preferences
    function readPrefs() {
      const fallback = { autoRise: true, pinned: [] }
      try {
        const raw = localStorage.getItem(PREFS_KEY)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        return {
          autoRise: parsed.autoRise !== false,
          pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((id) => typeof id === 'string') : [],
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

    // Activity means "a human prompt landed in this Session". The Session list
    // derives `updatedAt` from the persisted `lastPromptAt`; opening a Session
    // only moves `retainedBy.mainView`, so it never counts. Blank placeholders
    // and subagent children are not user activity either; a fork is a normal
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
    function iconManage() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'currentColor',
          fillRule: 'evenodd',
          'aria-hidden': true,
        },
        h('path', {
          d:
            'M14.8 8L11.9 10.25L11.4 13.89L8 12.5L4.6 13.89L4.1 10.25L1.2 8L4.1 5.75L4.6 2.11L8 3.5L11.4 2.11L11.9 5.75Z' +
            'M10.2 8a2.2 2.2 0 1 0-4.4 0 2.2 2.2 0 1 0 4.4 0Z',
        }),
      )
    }

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

    // ------------------------------------------------------------------ css
    const CSS = `
.wsm-launcher{position:fixed;z-index:5;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;pointer-events:auto}
.wsm-launcher:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wsm-launcher[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.wsm-backdrop{position:fixed;inset:0;z-index:900;background:transparent;pointer-events:auto}
.wsm-card{position:fixed;z-index:901;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.34);font-size:13px;line-height:1.45;pointer-events:auto}
.wsm-card *{box-sizing:border-box}
.wsm-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wsm-title{flex:1;font-size:13px;font-weight:600}
.wsm-close{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.wsm-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
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
.wsm-note{font-size:11px;color:var(--dsw-alias-label-secondary)}
.wsm-error{font-size:11px;color:var(--dsw-alias-state-error-primary)}
`

    // --------------------------------------------------------- header anchor
    // The shipped header locks its action group to 60px and clips, so a fourth
    // button inserted there hides the "add workspace" button. The launcher is
    // therefore rendered in the overlay layer and positioned over the free gap
    // between the section label and the search button; it consumes no layout.
    function measureAnchor() {
      const header = document.querySelector('[class*="sectionHeader"]')
      if (!header) return { visible: false }
      const rect = header.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return { visible: false }
      if (document.querySelector('[class*="searchSlotExpanded"]')) return { visible: false }
      const search = header.querySelector('[class*="searchButton"]')
      const label = header.querySelector('[class*="sectionLabel"]')
      const searchRect = search?.getBoundingClientRect()
      if (!searchRect || searchRect.width <= 0) return { visible: false }
      const left = searchRect.left - 34
      const labelRect = label?.getBoundingClientRect()
      if (labelRect && labelRect.width > 0 && left < labelRect.right + 4) return { visible: false }
      if (left < rect.left + 2 || left + 28 > rect.right) return { visible: false }
      return { visible: true, left, top: rect.top + 4 }
    }

    function useAnchor() {
      const [anchor, setAnchor] = React.useState(measureAnchor)
      React.useEffect(() => {
        let frame
        const update = () => {
          frame = undefined
          setAnchor(measureAnchor())
        }
        const schedule = () => {
          if (frame !== undefined) return
          frame = requestAnimationFrame(update)
        }
        schedule()
        window.addEventListener('resize', schedule)
        const header = document.querySelector('[class*="sectionHeader"]')
        let observer
        let resizeObserver
        if (header) {
          observer = new MutationObserver(schedule)
          observer.observe(header, { attributes: true, subtree: true, attributeFilter: ['class'] })
          if (typeof ResizeObserver === 'function' && header.parentElement) {
            resizeObserver = new ResizeObserver(schedule)
            resizeObserver.observe(header.parentElement)
          }
        }
        return () => {
          window.removeEventListener('resize', schedule)
          observer?.disconnect()
          resizeObserver?.disconnect()
          if (frame !== undefined) cancelAnimationFrame(frame)
        }
      }, [])
      return anchor
    }

    // ---------------------------------------------------------------- engine
    function measure() {
      const header = document.querySelector('[class*="sectionHeader"]')
      const actions = document.querySelector('[class*="headerActions"]')
      const root = header?.parentElement
      const rootRect = root?.getBoundingClientRect()
      const actionRect = actions?.getBoundingClientRect()
      const headerRect = header?.getBoundingClientRect()
      const width = Math.max(272, Math.min(420, (rootRect?.width ?? 300) - 12))
      const left = (rootRect?.left ?? 64) + 6
      const top = (actionRect?.bottom ?? headerRect?.bottom ?? 56) + 6
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

        ctx.effect(() => ctx.locale.register(NS, DICT), 'workspace-manager: locale')

        const t = () => ctx.locale.bind(NS)

        // ------------------------------------------------------------ surface
        function useTranslate() {
          const [, setTick] = React.useState(0)
          React.useEffect(() => ctx.locale.subscribe(() => setTick((n) => n + 1)), [])
          return t()
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
          const [confirm, setConfirm] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [error, setError] = React.useState(null)
          const [pos, setPos] = React.useState(measure)
          const [drag, setDrag] = React.useState(null)
          const [settle, setSettle] = React.useState(null)
          const [localOrder, setLocalOrder] = React.useState(null)
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
            const update = () => setPos(measure())
            update()
            window.addEventListener('resize', update)
            const onKey = (event) => {
              if (event.key === 'Escape' && dragRef.current === null) panel.set({ open: false })
            }
            window.addEventListener('keydown', onKey)
            return () => {
              window.removeEventListener('resize', update)
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
          const rowsItems = localOrder
            ? localOrder.map((id) => itemsById.get(id)).filter(Boolean)
            : items

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

          // Drag-to-reorder from the left grip (pointer events, ported from
          // dsh-rundeck): the dragged row follows the pointer, the other rows
          // translate with a transition to open the target slot, and the drop
          // index is resolved from the measured row heights every frame.
          const beginDrag = (event, index) => {
            if (busy || confirm || dragRef.current) return
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
              items.length === 0 ? h('div', { className: 'wsm-empty' }, tr('none')) : rows,
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
              h('div', { className: 'wsm-note' }, tr('autoRiseHint')),
              h('div', { className: 'wsm-note' }, tr('note')),
            ),
          )
        }

        function Launcher() {
          const anchor = useAnchor()
          const tr = useTranslate()
          const open = useStore(panel)
          if (!anchor.visible || open.open) return null
          return h(
            'button',
            {
              type: 'button',
              className: 'wsm-launcher',
              style: { left: anchor.left, top: anchor.top },
              title: tr('open'),
              'aria-label': tr('open'),
              onClick: () => panel.set({ open: true }),
            },
            iconManage(),
          )
        }

        function Surface() {
          const open = useStore(panel)
          return h(
            React.Fragment,
            null,
            h(Launcher),
            open.open
              ? h(
                  React.Fragment,
                  null,
                  h('div', { className: 'wsm-backdrop', onMouseDown: () => panel.set({ open: false }) }),
                  h(Panel),
                )
              : null,
          )
        }

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
