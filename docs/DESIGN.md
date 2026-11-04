# 工作区管理 内部设计

面向维护者。功能、安装、用法在 [README](../README.md)，这里只写结构、规则和改动时需要注意的地方。

## 运行位置与加载方式

包分两半。宿主半边 `index.js` 挂 HTTP 路由（当前只服务路径迁移），功能本体在 `lib/`；浏览器半边 `client.js` 是一个自包含的 bundle，用 `window.__ModuleLoader__.load` 注册，React 由宿主传入。`package.json` 的 `dsh.bundle.patch` 负责插入 Loader 行，`dsh.client` 负责把 bundle 投送给 Web GUI，两处都指向同一个包名。

## 面板入口

DSH 0.2.1-rc.3 的侧栏标题栏没有给插件留扩展位：它的动作容器宽度固定，且溢出内容会被裁掉，插第四个按钮会把官方的「添加工作区」挤出去。所以按钮渲染在 `shell.overlay` 槽位里，用 `position: fixed` 浮在标题与搜索按钮之间的空白处，位置由 `measureAnchor()` 用 `[class*="sectionHeader"]` 一类类名测量后算出。搜索框展开，或算出的位置与标题重叠、超出标题栏时，按钮直接不渲染。

这些类名由 CSS Modules 生成，属于 DSH 未公开的结构。DSH 改版后 `measureAnchor()` 量不到锚点，按钮就不出现——这是已知限制，不是本插件的缺陷。改动这块时先在目标 DSH 版本上确认类名仍然存在。

面板挂在按钮上，不贴侧栏列：点按钮时把它的矩形存进 `panel.anchor`，`measure(anchorRect)` 据此给出 `left = 按钮左边缘 - 6`、`top = 按钮下边缘 + 8`，再夹进视口。面板宽度仍按侧栏列宽计算，所以它会盖住一段对话区——这是有意的，和 dsh-temptask 的弹层一致；不要改回「对齐侧栏左边缘」。

面板打开期间按钮保持可见、显示激活态，并把 `z-index` 抬到遮罩之上（遮罩 900、卡片 901、按钮 902），这样再点一次就是收起。按钮一旦隐藏，弹层看着就没有来源了，也会失去这个关闭入口。

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

## 路径迁移

DSH 官方注册表没有 setPath/move（记录以 realpath 相等为唯一性），所以「把工作区指到另一个目录」只能是编排：搬目录（可选）→ 删旧记录 → 新路径建记录 → 安顿会话 → 归档 + 保排序位。编排移植自 `@aeroscis/dsh-temptask` 的 `promote.ts`——马山那份是「临时任务 → 正式工作区」，绑定任务账本；这里去掉任务模型，操作任意正式工作区，且多一条「目录已死、会话早已在新路径」的直接挂回路径。三条路线里明确排除中间那条：`table().update(id)` 直改登记 path 绕过实体快照，重启前其他工作区写入会用旧快照把迁移覆盖回去（temptask DESIGN 与 Liqiuheaven 的 dsh-workspace-manager README 各自记录过同款坑）。

**settler（lib/relocate.js `settleSessions()`）对每条旧会话的判定顺序**：

1. `sessionQuery.observeSession()` 读 header.cwd，realpath 已等于新路径 → **直接 `attachSession`**：id 不变、日志零复制，服务「用户手动搬过目录再重绑」的场景；
2. 否则若有已完成回合（`buildSeed()` 的 `completedPrefixBoundary`）→ 用事件前缀种子 `agents.create` 复刻一条新 cwd 的会话再挂回；
3. 都不行 → 跳过，稍后归档。

一条都没安顿成时开一条空会话占住节点——否则刚迁完的工作区立刻变成「空工作区」，会被面板自己的清理按钮认领。旧会话中除「直接挂回」外的全部归档（删旧记录后它们会掉「未分组」）。

**失败语义的次序很关键**：搬目录是唯一破坏性动作且最早发生（失败则什么都没变）；建记录失败会回滚搬移（目录搬回去）；复刻是尽力而为，缺口随结果返回。Windows 下 `rename` 的 EBUSY/EPERM 指向「目录被活进程锁住」，如实翻译成 dirBusy 提示而不是笼统的 fs 错误。

**client 对话框（RelocateDialog）**：行内展开替换该行；probe 结果驱动形态——登记目录存在时「把文件夹一起搬过去」默认勾选、可关；目录不存在时开关置灰、对话框降级为纯重绑。「把对话带过去」开关默认随 probe 的 sessionCount。执行走 `POST /dsh-workspace-manager/api/relocate`（confirm 门在宿主侧再拦一层）；成功后把 pinned 偏好里的旧 id 换成新 id（记录换了 id，置顶偏好要跟着工作区走），结果卡按 `orderKept`/`moved` 分行显示。

**宿主路由信任模型**沿用同源检查（loopback / connection.trustedHosts + 同源 Origin + 拒绝 sec-fetch-site: cross-site），两个接口永远返回 JSON。

## 样式

CSS 写在 `#wsm-styles` 这一个 style 元素里。每次加载都覆盖它的 `textContent`，而不是发现元素已存在就跳过，否则热替换后页面留着旧样式。

## 测试

浏览器半边不能被 Node 直接 import：它走 `__ModuleLoader__` 注册，并且依赖宿主提供的 `react`。三个测试改为从 `client.js` 里按边界注释切出纯函数块，放进空的 VM 上下文执行，切块由 `test/client-helpers.mjs` 的 `loadHelpers()` 完成。

因此边界注释是测试契约：移动或改名 `sessionActivity`、`restTops`、`moveInOrder`、`dropIndexFor`、`previewOffsets`，或者改动 `// ---- icons` 这条分隔注释，测试会直接失败，而不会静默地测一份拷贝。

## 置顶标记（官方侧栏行）

官方 Rows 只给会话行渲染 `PinnedIndicator`，工作区行上没有置顶视觉。项目行带着稳定锚点 `data-row-key="workspace:<workspaceId>"`（Ungrouped 桶没有 id，天然不受影响），所以浏览器半边把一枚小图钉按钮直接挂进官方行——插在 `rowActions` 之前，悬停时随官方两个按钮一起左让、肩并肩排列，不遮挡 ⋮ 菜单与新建会话按钮。

这枚图钉是真按钮，不是装饰：点它直接**取消置顶**，不必打开管理面板。官方项目行是带 `onClick`（展开/折叠）的 `div`，还可能带 `draggable`，所以按钮上对 `pointerdown` / `mousedown` / `click` 都做 `stopPropagation`，按图钉既不会展开工作区，也不会从图钉上开始拖动整行。取消置顶走的是同一个 `togglePin`，prefs 变化会同时驱动侧栏徽标移除和排序引擎回落。

React 随时可能重建行：`MutationObserver` 加 prefs/list 订阅驱动幂等的 `syncPinnedBadges`（每个 pass 只做「差集合」写入，无变化即无 DOM 事件，不会跟 React 打架）。选择器用属性前缀匹配而不碰官方 CSS Modules 的 hash 类名，生产构建下依然成立。

## 面板筛选框

面板顶部是筛选输入框，按行上显示的标题做大小写不敏感的子串匹配（标题为空时退回路径——那正是该行显示的内容）。**不匹配完整路径**：同一父目录下的工作区共享整段前缀，任何片段都会把它们全部命中，等于没有筛选。筛选生效期间禁用拖拽排序：落点顺序是按可见子集算出来的，写回 Host 会只重排一部分行、把隐藏行的相对位置弄乱；清空筛选后恢复。

## 发布形态自检

`scripts/check-release.mjs` 校验打包看不出来的部分：包名与版本格式、`publishConfig`、必备元数据、`engines`、许可证文件、更新日志里是否有当前版本、`files` 与 `exports` 指向的路径是否存在、bundle 是否按包名注册、双语词典能否解析。`npm run check` 会在它之后跑测试与 `npm pack --dry-run`。

## 自动送审

`.github/workflows/publish.yml` 在推 `vX.Y.Z` 标签时跑「自检 → `npm stage publish`」，用 OIDC 换短时 token，仓库里不放 `NPM_TOKEN`。

启用前必须先在 npmjs.com 的包设置里加一条 Trusted Publisher（GitHub Actions）：组织/用户名 `Aeroscis`、仓库 `dsh-workspace-manager`、workflow 文件名 `publish.yml`、environment 留空——**workflow 里没有 `environment:`**，两处不一致时认证会失败。要加 environment 就同时改 job。

几个约束：npm CLI 需 ≥ 11.15（workflow 里低于此版本会自动 `npm install -g npm@11`）；`id-token: write` 不能省，否则拿不到 OIDC token；标签与 `package.json` 版本不一致时 workflow 直接失败。

`npm stage publish` 只把包送进 stage 队列，维护者用 2FA 批准后才对外可见——这是 npm 现在的默认设计，不是配置没生效。批准入口在 npmjs.com 的包页面，或本地 `npm stage approve`。

npm 现在把直接 `npm publish` 标为不推荐：Trusted Publisher 配置提供了 **stage-only** 选项，勾上后该 workflow 的 `npm publish` 会被拒绝，只接受 `npm stage publish`。本地手动发版也走同一套——`npm stage publish` 再批准，不要再用裸 `npm publish`。

## 上架插件市场

市场的目录数据不在 dshmarket 仓库里，而在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的 `data/plugins/*.yml`：一个插件一个文件，两个 README 由脚本从这些 YAML 生成，手改 README 会被覆盖。上架 = 往那个仓库提一个 PR，只加一个文件。

条目形状（本仓库 `market/Aeroscis__dsh-workspace-manager.yml` 是副本，市场那边只读对方仓库，改描述要两边同步）：

```yaml
url: https://github.com/Aeroscis/dsh-workspace-manager
name: Aeroscis/dsh-workspace-manager
category: ui
description:
  en: '…'
  zh: '…'
icon: https://raw.githubusercontent.com/Aeroscis/dsh-workspace-manager/main/assets/icon-180.png
```

几条硬规则，错了 CI 直接拒：

- 文件名必须等于 `slugFor(url)`，即 `Aeroscis__dsh-workspace-manager.yml`；monorepo 子包是 `owner__repo--packages-x.yml`。
- 只允许 `url` / `name` / `category` / `description` / `icon` / `tarball` 六个字段，多写一个都会被指出；npm 包不由条目声明，市场按仓库的 `package.json.repository` 自动解析。
- `description.en` 必填、单行；含 `: `（冒号加空格）必须加引号。`zh` 可选，缺了维护者会补。
- `icon` 必须是 GitHub 托管的**位图**（`.png/.jpg/.webp`），SVG 不行；`assets/icon-180.png` 由 `icon.svg` 转换而来：`npm exec --package=sharp-cli -- sharp -i icon.svg -o assets/icon-180.png resize 180 180`。
- 仓库前置条件：`package.json` 声明 `dsh.bundle`（本仓库已有）；仓库创建满 1 天；仓库带 `dsh-plugin` topic。
- 描述会被审核者拿去和代码核对，夸大会被打回；分类选不准则不会，维护者会直接改。

条目通过只代表形状合格，合并前维护者会读代码。合并后通常在一天内出现在市场与站点上。
