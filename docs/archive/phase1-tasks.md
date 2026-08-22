# Phase 1 开发任务清单（MVP 一次性交付）

> 来源：docs/plugin-marketplace-plan.md（v0.3）
> 编制：2026-08-19
> 状态：待确认边界后执行
> 已完成（本轮）：市场插件骨架 + 4 条 API + 快照 + 官方安装 + client UI 初版（见方案附录 A）

---

## 范围分层

### P0 — 市场插件功能完善（plugins/plugin-marketplace，核心价值）✅ 已完成并端到端验证

- [x] **P0-1 分类 chips**：`classify()` 12 类；client 顶部分类 chips（`全部/视觉多模态/…/其他`）
- [x] **P0-2 详情视图**：client 卡片点击展开 README（`GET /api/detail?full_name=`，raw.githubusercontent，按需请求）
- [x] **P0-3 搜索强化**：name/full_name/topics 过滤 + 已装优先/精选优先/star 降序复合排序
- [x] **P0-4 白名单扩展**：`CURATED` 含官方与社区精选 7 项；client "精选"徽章
- [x] **P0-5 adaptor**：`REDIRECTS` 结构就绪（可增量补充）
- [x] **P0-6 更新**：`POST /api/update` → 官方 `dsh plugin add` 覆盖升级；client install/update/remove 按钮状态机
- [x] **P0-7 热启停**：`POST /api/toggle` 写官方 `cordis.patch.yml`（`- id` + `disabled`）；手工条目不覆盖（写前校验）；已验证写入
- [x] **P0-8 skill/preset**：`detectType()`；`installFileType()` 走官方 `~/.dsh/skills/`、`~/.dsh/.agent-presets/`（git clone + 复制，无脚本执行）
- [x] **P0-9 数据层**：GitHub API 刷新 + `refresh=1` 触发；host API 全通过

### P1 — 官方命令集成（客户端能力扩展，§12）

- [ ] **P1-1 共享命令执行器**：client-runtime 暴露 `dshExec(args, {cwd,profile})`（复用 resolveRuntime 解析链 + normalizeDshCommand），输出流式回调；市场安装/更新/移除与壳层命令统一走它（单一事实源）
- [ ] **P1-2 Electron 内嵌终端面板**：新 BrowserWindow/面板，xterm.js + node-pty 启动 `dsh` shell（读 PATH/bundled runtime）；命令历史；输出脱敏（密钥形状打码）
- [ ] **P1-3 VS Code 集成终端命令**：`dsh.openTerminal` 命令，用 vscode 集成终端跑 `dsh`
- [ ] **P1-4 图形命令面板**：常用命令（plugin add/remove/why、web --dump-config、profile）表单化 + 实时输出；命令注册表预留扩展点

### P2 — 壳层入口与首启（客户端联动）✅ 完成并编译通过

- [x] **P2-1 首启自举**：`market-bootstrap.ts` 检测官方 profile deps，未装则自动静默执行 `dsh plugin add @coeasy/dsh-plugin-marketplace`（PATH 补全 + cmd 包装），成功后一次性提示；已接入 `main.ts` launchHarness（openHarness 后触发）
- [x] **P2-2 Electron 托盘入口**：`app-tray.ts`/`status-tray.ts` 加"插件市场/Marketplace"菜单项，`onMarket: showMainWindow`
- [x] **P2-3 VS Code 命令入口**：`dsh.marketplace.open` 命令（复用启动逻辑，webview 面板）；已注册 contributes.commands

编译：`pnpm compile:desktop` ✅ `pnpm compile:vscode` ✅

### P3 — pnpm 前置保障（官方通道地基）✅ 核心完成

- [x] **P3-1 pnpm 检测 + PATH 补全**：`childEnv()` 合并常见 pnpm bin 目录（%APPDATA%\npm、~/.local/share/pnpm 等），`runPluginCommand` 生效；`GET /api/pnpm` 检测
- [x] **P3-2 自动安装**：`detectPnpm()` 失败返回 `installed:false` 供前端提示（自动安装闭环留待 UI 联动）
- [x] **P3-3 版本兜底**：官方 `dsh plugin add` 由 pnpm reconcile 处理重装；已验证插件内官方通道端到端

> ⚠️ 已知限制：`detectPnpm` 在 dsh 内置 node 环境内 spawn `.cmd` 有边缘问题，返回兜底 `installed:false`；不影响官方安装通道（runPluginCommand 直接 node+bin.js）。

### P4 — 质量与回归

- [ ] **P4-1 测试**：registry 分类/识别、install spec 生成、官方状态读取、patch 层读写、pnpm 检测各单测
- [ ] **P4-2 红线回归**：官方装→市场识别；市场装→官方 remove；patch 层零污染；手工条目不覆盖
- [ ] **P4-3 `pnpm verify`**：hygiene + test + layer-audit + compile 全通过
- [ ] **P4-4 打包验证**：build-clients 后 portable/NSIS 内启动，市场 + 命令可用

---

## 依赖顺序

```
P0-1..P0-5（数据/UI 基础）
  → P0-6/P0-7/P0-8（生命周期）
  → P1-1（共享执行器）
    → P1-2/P1-3/P1-4（命令集成）
  → P2-1..P2-3（壳层联动）
  → P3-1..P3-3（pnpm 保障）
  → P4-1..P4-4（质量回归）
```

## 交付物

- 市场插件升级（分类/详情/更新/热启停/skill/preset/白名单/adaptor）
- client-runtime 新增 `dshExec` 共享执行器
- Electron 内嵌终端 + VS Code 命令 + 图形命令面板
- 壳层首启自举 + 托盘/命令入口
- pnpm 检测与自动安装
- 测试 + 红线回归 + 打包验证
