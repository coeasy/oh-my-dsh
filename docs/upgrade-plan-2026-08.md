# oh-my-dsh 全面升级改造方案

> 状态：方案评审稿（2026-08-22）
> 范围：桌面端 + VS Code 双外壳、内置插件 UI、构建/发布链路
> 基线：已提交 `0df4894`（248 文件，usage-analytics/model-config/degeneration-guard 三插件 + 桌面修复固化）
> 引擎基线：deepseek-harness `dsh-v0.1.1-rc.2`（commit `b150a551`）

---

## 1. 项目主要功能点（概要）

my-dsh 是 DeepSeek Harness（DSH）内核的**非 fork 客户端包**，上层两个外壳共享一套 runtime 与 Cordis 插件：

| 组件 | 功能 |
|---|---|
| `apps/desktop` | Electron 壳（NSIS/portable/zip + online 精简版）：托盘、工作区选择、API Key、诊断导出、手机 LAN 桥、引擎在线更新检测 |
| `apps/vscode` | VS Code / Cursor VSIX 面板客户端 |
| `packages/client-runtime` | 引擎下载/解析/spawn/就绪/关闭、`--patch` 注入、loopback 安全校验 |
| `plugins/embedded-client` | 锁 web 到 `127.0.0.1:0` + ready 文件（基础设施补丁） |
| `plugins/plugin-marketplace` | 社区插件市场：目录/安装/卸载/备份，经 host IPC broker + 原生确认边界 |
| `plugins/model-config` | 分阶段模型路由/推理力度/Profiles |
| `plugins/degeneration-guard` | 退化防护（重复/死循环/工具链/turn 上限检测与升级） |
| `plugins/usage-analytics` | 用量采集/归一化/存储/查询 + 底部实时用量条 |
| `engine.lock.json` + `scripts/*` | 一键拉取/钉死内核、跨平台（Win/mac/Linux）打包、`engine:update` 自动更新 |

当前基线：233 项通过测试；内置插件已装入 primary+mirror 两个 home；web ready；渲染进程 CPU 正常。

---

## 2. 问题清单（按严重度）

### P0 — 根因级架构脆弱性

**P0-1 插件 UI 依赖上游 CSS-Modules 哈希类名（正反馈源）**
`apps/desktop/src/preload.ts` 用 `[class*="footArea"]` / `collapsed` 局部名做锚点投影 `data-dsh-sidebar-*`（[SidebarRoot.tsx](file:///p:/github_public/oh-my-dsh/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx) 由 CSS Modules 渲染）。上游改类名即断——本仓库 P0-1 白屏/按钮消失的深层土壤正是这种外壳 DOM 注入写法。已修但仅缓解，未根治。

**P0-2 插件配置界面是一套重复维护的独立 UI**
`apps/desktop/plugin-ui/*.js`（构建自各插件 `ui-src/mount.ts`）走「独立 WebContentsView + 双份 bundle」，与 harness 官方浏览器插件机制重复造轮子，需同步维护；与 harness 内 Settings 卡片两套状态可能不同步。

### P1 — 交付/分发

**P1-1 引擎在线更新闭环未进 release**
客户端已能检测（`engine-updater.ts`），但「审批→激活→重启→回滚」完整流程与 rollback 在发布产物内未闭环（roadmap P2）。

**P1-2 签名缺失**
未配置 Windows Authenticode / macOS Developer ID + notarization；未签名构建触发 SmartScreen / Gatekeeper（roadmap P1）。

**P1-3 桌面端无真机 E2E**
当前桌面检查多为单元级 + 打包 smoke（roadmap P0）；首启/导航/退出/恢复无真实 E2E。

### P2 — 工程卫生

**P2-1 构建/运行残留曾入库**
已通过 `0df4894` 前的 `.gitignore` 扩展排除 `dist-build/`、`dist-release-online/`、`tmp-asar*/`、根 `tmp-*.{mjs,cjs,txt}`（含 `tmp-token.txt` 疑似令牌）。需复核无其他敏感残留。

**P2-2 usage-analytics 的 `ui/bundle.js` 与 `model-config/degeneration-guard` 去向不一致**
usage-analytics 有独立 `.gitignore`，ui bundle 被忽略；其余两插件 ui bundle 已入库。策略不一致，需统一。

**P2-3 内存/CPU 顾虑残留**
渲染进程历史曾因 MutationObserver 回环吃满 CPU（已修复）；改用官方槽后 `queueSidebarSync`/`MutationObserver` 的整体注入可整体移除，理应进一步收敛。

---

## 3. 改造方案

### Phase A（推荐首期）——官方扩展槽迁移（根治 P0-1/P0-2）

**方向**：放弃「preload DOM 注入 + 独立 WebContentsView」双套 UI，改为在 harness 官方 client 槽位注册，彻底脱离哈希类名。

官方侧已确认（[slots.ts](file:///p:/github_public/oh-my-dsh/deepseek-harness/packages/client/ui-sidebar/src/client/contract/slots.ts)）：
- `sidebar.footer.action`：`kind:'list'`，owner prop `{ wide: boolean }`
- `sidebar.settings`：`kind:'single'`，owner prop `{ wide: boolean }`
- 注册方式：`ctx.slots.register({ name: 'sidebar.footer.action' }, Component)`，需独立 `dsh.client` 浏览器插件（`.` 与 `./client` 导出、`lib/client.js` bundle、进入 web profile 的 cordis.patch + package deps）。

**关键分层前提**：我们现有 `model-config/degeneration-guard/usage-analytics` 是 **Node/web-profile 宿主插件**（引擎侧服务，负责 HTTP/IPC 与持久化）；而 `sidebar.footer.action` 渲染发生在 **浏览器 client 侧**（web SPA）。因此不是给现有插件加个按钮，而是**新增一层 client 浏览器插件**（如 `@dsh/plugin-desktop-bridge`），在 web SPA 内注册槽位按钮，点击经现有 `window.dshDesktop.*` 桥（preload 暴露面不变）唤起桌面配置界面。

**迁移路径（A1–A4 递增落地，可分段回退）**：
1. **A1 新增 `plugins/desktop-bridge` 客户端插件**：注册 `sidebar.footer.action` 的三个槽位（模型配置/退化防护/用量分析），owner prop `wide` 决定宽/窄渲染；调用既有 `plugin-config:open` IPC。此阶段仅把「入口按钮」从 DOM 注入迁到官方槽，配置界面仍用现有 WebContentsView。
   - 收益：彻底删掉 preload 里 `syncSidebarAttributes`/`mountPluginConfigEntries`/`MutationObserver` 主体（手机按钮迁移到 `sidebar.footer.action` 或保留独立槽），渲染进程 CPU 进一步收敛，无哈希类名依赖。
2. **A2 手机配对按钮并入同槽**：从 preload `mountMobileButton` 迁入，移除整段 CSP 相关内联样式。
3. **A3 配置界面迁到官方 `/plugins/<id>/client.js` 机制**（消除 P0-2 双份 UI）：利用 harness 的 `dsh.client rows → /plugins/<id>/client.js` 浏览器插件路径渲染配置面板，删除 `apps/desktop/plugin-ui/*.js` 与 `ui-src/mount.ts` 双份工程。**收益最大、成本最高，建议独立成子项目。**
4. **A4 防回归**：补一条「槽注册接入成功」的静态度量（如 `verify-client-packages` 式校验 client 行入 web profile），锁住 future 迁移回归；保留现有 preload 桥防回归测试直到 A3 全部删除。

**回归策略**：A1 落地后 DOM 注入按钮与官方槽按钮可见重复时，一周观测期内可设置 feature flag 切换，确认官方槽渲染稳定后再删旧注入，避免一次性大改不可回滚。

### Phase B —— 交付层补齐

- **B1 引擎在线更新闭环**：实现 `engine-updater.ts` 的「审批→激活→重启→回滚」完整状态机，release 产物接入；rollback 保留上一版 commit 的本地副本。
- **B2 签名接入**：`signing.md` 已有流程文档。配置 `CSC_LINK`/`CSC_KEY_PASSWORD`（Win Authenticode）与 macOS notary 环境变量；CI 打 release 时校验签名结果，把 SHA256 与签名状态写进 release notes。
- **B3 真机桌面 E2E**：新增首启（选 workspace + API Key）、loopback 导航、退出收割、恢复的端到端用例（Playwright/Electron），进 CI 的 Windows runner。

### Phase C —— 工程卫生（低成本高价值）

- **C1 统一 ui bundle 策略**：明确 build 产物一律 `gitignore`（入 `.gitignore`），源码 `ui-src/*.tsx` 入库；删除 usage-analytics 独立 `.gitignore` 的不一致。
- **C2 复核敏感残留**：`git log`/工作树扫描确认无 token/证书/`.env` 值入库。
- **C3 两份 TODO 收敛**：`TODO-BUILD.md` 已全部完成、`TODO-REPAIR.md` 仅剩 S9（真机 UI 验证）；把 S9 并入 B3，归档 TODO 文件。

---

## 4. 建议实施顺序

| 阶段 | 改动面 | 风险 | 前置 |
|---|---|---|---|
| C1/C2/C3 工程卫生 | 小 | 低 | — |
| B3 真机 E2E | 中 | 中 | 安装产物 |
| A1 官方槽入口 | 中 | 中 | 需 client 插件基础设施 |
| B1 更新闭环 | 中 | 中 | Packaged 客户端 |
| B2 签名 | 小 | 低 | 证书/账户 |
| A2 手机槽迁移 | 小 | 中 | A1 |
| A3 配置界面统一 | 大 | 高 | A1（建议单独立项） |
| A4 防回归 | 小 | 低 | A1 |

---

## 5. 验证计划

1. `pnpm typecheck && pnpm lint && pnpm test`（基线应保持全绿）。
2. A1 落地后 `pnpm compile:desktop` 走通长链；受控启动确认「官方槽按钮出现、旧 DOM 按钮按 flag 隐藏、配置面板可开、渲染进程 CPU 正常、无 EPERM/dsh.cmd/integrity 错误」。
3. B3 后接 CI Windows runner 跑 E2E。
4. B2 后 release 校验 `SHA256SUMS.txt` + 签名状态。
5. 真机视觉复验（约束原 TODO-REPAIR S9）。

---

## 6. 决策请求

| # | 决策项 | 建议 |
|---|---|---|
| D1 | Phase A 是否先做 A1（官方槽入口，配置面板暂留现有方案） | 建议：是，收益/风险比最优 |
| D2 | A3（配置界面统一到 `/plugins/<id>/client.js`）是否单独立项 | 建议：是，改动面大独立评审 |
| D3 | 内置插件复选「桌面端 VS Code + 桌面版都吃官方槽」 | 桌面版为准，VS Code 面板共享 client 插件 |
| D4 | 批准后按 C → B3 → A1 → B1/B2 → A2/A3 顺序执行 | — |