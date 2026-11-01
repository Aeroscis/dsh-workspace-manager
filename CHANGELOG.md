# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/) 规范。

发布渠道：npm [`@aeroscis/dsh-workspace-manager`](https://www.npmjs.com/package/@aeroscis/dsh-workspace-manager) · 源码 <https://github.com/Aeroscis/dsh-workspace-manager>

## [未发布]

## [0.3.0] - 2026-11-01

首次公开发布。之前的 0.1.x / 0.2.x 只在本地 profile 里以目录链接方式开发，没有发布到 npm，因此版本号不连续。

### 新增

- **活动自动上浮**：最近收到人类 prompt 的工作区升到第一个非运行工作区之上。只认你发出的新消息——打开会话、浏览会话、助手回复都不算活动；空白新会话与子代理会话不计入。可在面板顶部关闭。
- **置顶**：把工作区固定在列表最前，置顶之间按勾选顺序排列。
- **拖拽排序**：每行左侧的汉堡把手按住上下拖动，该行跟手抬起、其余行实时让位、松手滑入槽位；贴边自动滚动，Esc 取消，按住方向键可逐行微调。顺序写入 Host 的 `workspaceIds`，所有窗口同步。
- **一键整理**：按「置顶 → 运行中 → 最近发送消息 → 其余（按最近会话时间）」重排一次，只在点击时执行。
- **移除工作区 / 清理空工作区**：带确认条；移除只删注册表项，会话归入「未分组」而不删除。
- 中英双语界面（`locale/zh.json`、`locale/en.json`）。

### 声明

- `engines.dsh` 为 `^0.2.1-rc.3`：只在该版本的侧栏结构上验证过；侧栏选择器变化时按钮会不出现，见 README「已知限制」。
- 顺序修改是持久的 Host 写入，没有「仅本页」模式。

## [0.2.1] and earlier

本地开发期版本，未发布。
