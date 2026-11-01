# 工作区管理 内部设计

面向维护者。功能、安装、用法在 [README](../README.md)，这里只写 client.js 的结构、规则和改动时需要注意的地方。

## 运行位置与加载方式

包分两半。宿主半边 `index.js` 的 `apply()` 是空函数，作用只是让 Loader 拥有这个包的生命周期；浏览器半边 `client.js` 是一个自包含的 bundle，用 `window.__ModuleLoader__.load` 注册，React 由宿主传入。`package.json` 的 `dsh.bundle.patch` 负责插入 Loader 行，`dsh.client` 负责把 bundle 投送给 Web GUI，两处都指向同一个包名。

## 面板入口

DSH 0.2.1-rc.3 的侧栏标题栏没有给插件留扩展位：它的动作容器宽度固定，且溢出内容会被裁掉，插第四个按钮会把官方的「添加工作区」挤出去。所以按钮渲染在 `shell.overlay` 槽位里，用 `position: fixed` 浮在标题与搜索按钮之间的空白处，位置由 `measureAnchor()` 用 `[class*="sectionHeader"]` 一类类名测量后算出。搜索框展开，或算出的位置与标题重叠、超出标题栏时，按钮直接不渲染。

这些类名由 CSS Modules 生成，属于 DSH 未公开的结构。DSH 改版后 `measureAnchor()` 量不到锚点，按钮就不出现——这是已知限制，不是本插件的缺陷。改动这块时先在目标 DSH 版本上确认类名仍然存在。

## 顺序写入

只用客户端 API：`ctx.workspaces.insertBefore(id, beforeId)` 写顺序，`ctx.workspaces.delete(id)` 移除注册项。没有「只改本页」的路径，`insertBefore` 会写 Host 保存的 `workspaceIds`，所有窗口同步。

`applyOrder()` 按目标顺序逐位调用 `insertBefore`，每次用当前顺序里该位置上的 id 作锚点；锚点为空时 `insertBefore` 追加到末尾。写之前先比对当前顺序，相同就整体跳过，避免无意义的 Host 写入。

## 自动上浮

`step()` 做两趟：

1. 把置顶项提到最前，置顶之间按偏好里记录的勾选顺序；
2. 开关打开时，如果活动工作区不在置顶里，把它插到「第一个既不是置顶、也不在运行」的行之前。

第二趟的边界必须同时跳过置顶与运行中。只跳过运行中时，活动行会先越过置顶行，下一趟置顶又把顺序推回来，两趟来回改写。`test/sort-rule.test.mjs` 用反复执行到稳定的方式锁住这条性质。

触发方式：订阅 `workspaces.list` 与 `sessions.list` 两个 store，150 毫秒去抖后进入 `pump()`；`pump()` 串行执行，最多 8 趟，或到顺序不再变化为止。指针拖动期间 `pointerDragging` 为真，`step()` 直接返回 false，避免写入改到指针下面那一行。

## 活动的定义

活动指该工作区里最新的「人类 prompt 时间」。`sessions.list` 的 `updatedAt` 就是持久化的最后一条人类 prompt 时间；打开会话只改 `retainedBy`，不动 `updatedAt`。`blank` 占位会话与 `origin` 为 `subagent` 的子会话被排除，fork 出来的会话按普通会话计算。这条规则只有一个实现：`sessionActivity()`。

## 拖动

用指针事件，不用 HTML5 draggable。按下时量一遍各行矩形，`restTops()` 算出各行的静止位置，`dropIndexFor()` 把指针位移换算成落点索引，`previewOffsets()` 算出其余行要让出的位移；松手后先按目标顺序重排 DOM，再用两帧把拖动行的补偿位移归零。指针进入列表上下边缘 26 像素内时每帧滚动 10 像素。

## 样式

CSS 写在 `#wsm-styles` 这一个 style 元素里。每次加载都覆盖它的 `textContent`，而不是发现元素已存在就跳过，否则热替换后页面留着旧样式。

## 测试

浏览器半边不能被 Node 直接 import：它走 `__ModuleLoader__` 注册，并且依赖宿主提供的 `react`。三个测试改为从 `client.js` 里按边界注释切出纯函数块，放进空的 VM 上下文执行，切块由 `test/client-helpers.mjs` 的 `loadHelpers()` 完成。

因此边界注释是测试契约：移动或改名 `sessionActivity`、`restTops`、`moveInOrder`、`dropIndexFor`、`previewOffsets`，或者改动 `// ---- icons` 这条分隔注释，测试会直接失败，而不会静默地测一份拷贝。

## 发布形态自检

`scripts/check-release.mjs` 校验打包看不出来的部分：包名与版本格式、`publishConfig`、必备元数据、`engines`、许可证文件、更新日志里是否有当前版本、`files` 与 `exports` 指向的路径是否存在、bundle 是否按包名注册、双语词典能否解析。`npm run check` 会在它之后跑测试与 `npm pack --dry-run`。
