# oh-my-dsh 界面与插件架构问题梳理及修复方案

> 状态：方案评审稿（2026-08-22）
> 范围：桌面端（apps/desktop）插件界面展示问题、插件架构问题、构建/安装链路问题
> 引擎基线：deepseek-harness `dsh-v0.1.1-rc.2`（commit `b150a551`，已于本机完成切换）

---

## 1. 项目功能梳理

### 1.1 定位

本仓库（dsh-client-pack / my-dsh）是 DeepSeek Harness（DSH）内核的**非 fork 客户端包**，提供两种外壳：

| 组件 | 产物 | 说明 |
|---|---|---|
| `apps/desktop` | Electron 壳（NSIS/portable/zip + online 精简版） | 加载 harness web UI，注入桌面专属功能 |
| `apps/vscode` | VS Code / Cursor VSIX | 面板式客户端 |
| `packages/client-runtime` | 库 | 引擎下载/启动/就绪/关闭、spawn 与 patch 注入 |
| `plugins/*` | Cordis 插件 | 安装进 harness web profile 的扩展层 |
| `engine.lock.json` | 锁文件 | 上游仓库 + ref + pinnedCommit |

### 1.2 插件清单与 UI 面

| 插件 | 宿主层 | 功能 | 期望的 UI 展示 |
|---|---|---|---|
| `embedded-client` | 引擎补丁（spawn 时 `--patch` 热插） | 锁 webserver 到 127.0.0.1:0 + ready 文件 | 无直接 UI（基础设施） |
| `plugin-marketplace` | web profile 常驻 | 社区插件市场：目录/安装/卸载/备份 | harness 内 Settings → Marketplace 页面 |
| `model-config` | web profile 常驻 | 分阶段模型路由/推理力度/Profiles | 桌面侧边栏「模型配置」按钮 → 独立配置窗口 |
| `degeneration-guard` | web profile 常驻 | 退化防护（重复/死循环检测与升级） | 桌面侧边栏「退化防护」按钮 → 独立配置窗口 |
| `usage-analytics` | web profile 常驻 | 用量采集/归一化/存储/查询 | 桌面侧边栏「用量分析」按钮 + 窗口底部实时用量条 |

### 1.3 桌面端展示链路（设计意图）

```
Electron 主进程 (main.ts)
 ├─ 启动 harness：spawn-host → dsh web --patch <overlay> --host 127.0.0.1 --port 0
 ├─ ensureMarketFreshness()        → dsh plugin --profile web add file:<marketplace>
 ├─ ensureFirstPartyPlugins()      → dsh plugin --profile web add file:<3个内置插件>
 └─ 主窗口 loadURL(harness web UI)，preload.cjs 注入页面
      ├─ 手机配对按钮   → [data-dsh-sidebar-footer]
      ├─ 插件按钮×3    → [data-dsh-sidebar-footer]（模型配置/退化防护/用量分析）
      ├─ 用量状态栏     → document.body 底部固定条（IPC 轮询 usage-analytics:action）
      └─ plugin-config:open IPC → 主进程 showPluginConfigWindow()
           → userData/plugin-ui/<plugin>.html + .js（来自 resources/plugin-ui）
```

---

## 2. 问题清单

### P0-1（根因）插件按钮在界面上全部不显示

**证据链**：
- `apps/desktop/src/preload.ts` 的 `mountMobileButton()` / `mountPluginConfigEntries()` 都以 `document.querySelector('[data-dsh-sidebar-footer]')` 为挂载锚点；
- 上游 `deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` 使用 **CSS Modules**（`SidebarRoot.module.css`），渲染出的侧边栏 DOM 上**不存在任何 `data-dsh-sidebar-*` 属性**（全仓库 grep 无写入方，旧版 rc.7/rc.8 与新版 rc.2 均如此）；
- 因此 `footer` 恒为 `null`，两个挂载函数**每次都直接 return**——手机按钮与三个插件入口从未渲染过。这正是"插件在界面上均无展示"的直接原因。

**次生问题（同根因）**：两处 `MutationObserver` 的 `attributeFilter: ['data-dsh-sidebar-wide']` 监听的是**从未被设置的属性**，属于死代码；宽窄态切换后挂载逻辑不会被触发。

### P0-2 online（system-runtime 精简版）打包缺资源

`apps/desktop/electron-builder-online.yml` 的 `extraResources` 缺少：
- `plugin-ui`（三个插件配置窗口的 UI bundle）；
- `out/bundled-plugins`（三个内置插件的安装源）。

**后果**：online 版安装后：
- 点击侧边栏插件按钮 → `showPluginConfigWindow()` 中 `existsSync(bundleSrc)` 为 false → **静默 return，点击无反应**；
- `ensureFirstPartyPlugins()` 找不到 `resources/bundled-plugins/*` → 内置插件完全不安装，用量状态栏显示「Usage Analytics 未启用」。

### P1-3 引擎版本漂移

`engine.lock.json` 锁定 `dsh-v0.1.0-rc.8`（141eb6f），但本地 clone 实际停在 `dsh-v0.1.0-rc.7`（99f6f02）——锁与实况不一致，构建产物不可复现。

### P1-4 新版引擎兼容性核对结论（rc.7 → v0.1.1-rc.2）

逐项核对结果（**均兼容，无需改调用代码**）：

| 接口 | 我方调用 | 新版实现 | 结论 |
|---|---|---|---|
| 插件安装 | `dsh plugin --profile web add file:<path>` | `runPlugin(profile, args)` pnpm 转发 + reconcile `dsh.profile.bundles` | ✅ 兼容 |
| web 启动 | `dsh web --patch <yml> --host 127.0.0.1 --port 0` | `--patch` 可重复、`--host/--port` 保留 | ✅ 兼容 |
| profile 布局 | `$DSH_HOME/profiles/web` | `resolveProfileDir()` = `home/profiles/<name>` | ✅ 不变 |
| web 模板 | dsh-base + dsh-web-app | `PROFILE_TEMPLATES.web` 同 | ✅ 不变 |
| bundle patch 格式 | `- insert: [{id, name}]` / `- id: x + config` | 官方 patch 同格式 | ✅ 兼容 |
| **新增能力** | — | 侧边栏官方扩展槽 `renderSlot('sidebar.footer.action')` / `renderSlot('sidebar.settings')` | 架构演进机会（见 4.3） |

### P2-5 架构脆弱性：外壳注入 vs 官方插件 UI 机制

当前设计：preload **DOM 注入 + 独立 BrowserWindow 配置页**，与 harness 插件体系并行。弱点：
1. 依赖 CSS Modules 哈希后类名的**局部名存活**（`[class*="footArea"]`）。Vite 默认 `[name]_[local]_[hash:5]` 保留局部名，但上游一旦改名 `footArea` 或自定义 `generateScopedName`，锚点即断——**这是本次 P0-1 的深层土壤**（当初按不存在的 `data-*` 约定写锚点，无人验证过真实 DOM）。
2. 配置窗口是另一套 HTML/bundle（`apps/desktop/plugin-ui/*.js`，构建自各插件 `ui-src/mount.ts`），与 harness 官方「dsh.client rows → `/plugins/<id>/client.js`」的浏览器插件机制**重复造轮子**，双份 UI 代码需同步维护。
3. 插件在 harness 侧的展示（Settings 页卡片等）依赖 `ui-settings-plugins` 行 + manifest 权限，与桌面壳注入的按钮两套体系并存，状态可能不同步。

### P2-6 构建链路验证点（未验证项）

- `usage-analytics` esbuild `--external:sql.js`：profile 安装时依赖 `pnpm` 装入 `dependencies.sql.js`（file: 安装会装依赖）——需在真机走一遍安装确认；
- `copy-bundled-plugins.mjs` 只复制 `package.json / cordis.patch.yml / out`：若插件依赖未随行且 profile 装不上即失败；
- 根 `package.json` 的 `compile:desktop` 长链（bump 版本→三插件 build→esbuild 双产物→三个 copy 脚本）任何一环失败即整体失败，本地与 CI 都要验证；
- 工作区当前有约 96 个文件的**既有未提交改动**（历史重构残留），打包前需确认基线一致性。

---

## 3. 修复方案

### 3.1 【已实施·待验证】preload 侧边栏 DOM 桥接（修 P0-1）

**方案**：在 preload 中新增 `syncSidebarAttributes()`：
- 用 `[class*="footArea"]`（CSS Modules 局部名稳定存活）找到真实 footer，其父元素即侧边栏根；
- 向两者投影 `data-dsh-sidebar-footer` / `data-dsh-sidebar-root` 属性；
- 由根元素是否含 `collapsed` 类推导宽窄态，写 `data-dsh-sidebar-wide`；
- `MutationObserver` 改监听 **class 属性变化**（React 重渲/收展的真实信号），每次变更先 `syncSidebarAttributes()` 再幂等重挂载；桥接自身只写 `data-*` 不动 class，无回环。

**代价**：零新 IPC channel（不触碰 C3 安全基线测试）；挂载函数本就幂等。

**残余风险**：上游改名 `footArea`/`collapsed` 局部名（低概率）。已加防回归测试锁住桥接存在性与锚点写法。

### 3.2 【已实施·待验证】online 版资源补齐（修 P0-2）

`electron-builder-online.yml` `extraResources` 增补 `plugin-ui` 与 `out/bundled-plugins`，与完整版对齐（online 版仅去除 runtime/harness 携带，不应缺插件资源）。

### 3.3 【方案·中期可选】迁移到官方 sidebar 扩展槽（修 P2-5 根）

新版 harness 提供 `renderSlot('sidebar.footer.action')` 与 `renderSlot('sidebar.settings')`：以 `dsh.client` 行注册一个**客户端 Cordis 插件**（如 `@dsh/plugin-desktop-bridge`），在槽内渲染官方按钮，点击后经现有 `window.dshDesktop.*` 桥（preload 暴露面不变）唤起配置窗口。

**收益**：脱离哈希类名依赖、获得官方主题/宽窄态/Tooltip 一致性、删除双份 UI 的可能性。
**成本**：需新增一个 client bundle 并进 web profile；改动面大。
**建议**：本次先落地 3.1/3.2 修复展示问题，3.3 作为后续演进项单独立项。

### 3.4 【已实施】防回归测试（修 P1-1 类问题复发）

`apps/desktop/tests/preload.test.ts` 新增 `sidebar DOM bridge` 用例：断言桥接函数存在、锚点为 `footArea` 类、投影 `data-dsh-sidebar-*`、observer 监听 `class`。

### 3.5 【已完成】引擎更新（修 P1-3）

- harness clone → `dsh-v0.1.1-rc.2`（b150a551）；
- `engine.lock.json` ref/pinnedCommit 同步更新；
- 兼容性核对见 2.P1-4，无需改调用代码。

---

## 4. 验证计划（下一步执行）

### S5 本地验证

1. `pnpm install`（上次被中断，需重跑）；
2. `pnpm test`——含新增的桥接防回归用例；
3. `pnpm compile`——完整走通 `compile:desktop` 长链（插件 build 指纹 → esbuild → copy ×3）；
4. `pnpm verify` / smoke：引擎真实启动，人工核对：
   - 侧边栏出现「模型配置/退化防护/用量分析」三按钮（宽窄两态）；
   - 点击各按钮打开配置窗口并能渲染数据；
   - 底部用量状态栏轮询刷新；
   - 手机配对按钮出现；
   - harness 内 Settings → Marketplace 正常。

### S6 第三方构建验证

1. `tools/build-clients.cmd`（stable 渠道 = 最新非预发布 release，受新 engine.lock 约束）；
2. 产物：VSIX + NSIS/portable/zip + online 版；
3. 校验包内 `resources/plugin-ui/*.js`、`resources/bundled-plugins/*` 存在（完整版与 online 版都要查）；
4. `scripts/install-clients.mjs` 安装后启动，重复 S5-4 人工清单。

---

## 5. 当前工作区状态（如实披露）

- 引擎已切至 `dsh-v0.1.1-rc.2`，`engine.lock.json` 已更新；
- 本轮已改 4 个文件（在"先出方案不改码"指令之前完成）：`apps/desktop/src/preload.ts`（桥接）、`apps/desktop/electron-builder-online.yml`（资源补齐）、`apps/desktop/tests/preload.test.ts`（防回归）、`engine.lock.json`；
- 工作区另有约 96 个文件的**既有未提交改动**（非本轮产生，属历史重构），与 P0-1 无关但影响构建基线，建议构建前先 `git diff` 复核或提交固化；
- `TODO-REPAIR.md` 为进度跟踪文件。

---

## 5.1 启动流程优化（2026-08-22 新增）

**问题**：客户端启动慢，启动流程卡在插件加载。

**根因**：`launchHarness()` 中 `ensureMarketFreshness()`（安装/刷新 marketplace）与 `ensureFirstPartyPlugins()`（安装/刷新 3 个内置插件）都是**同步 await**，每次通过 `dsh plugin --profile web add file:...`（pnpm）执行，升级/指纹变化时还触发 remove+add，耗时阻塞在关键路径上。

**优化**：将两段插件安装改为**后台异步（fire-and-forget）**：
- 主窗口（openHarness）一就绪即返回，插件不再阻塞启动；
- 引擎内置 `watchUserPatches`（Cordis HMR）会自动热载 profile patch 变化 → 插件后台装完自动出现在 UI，**无需重启引擎或刷新页面**；
- 错误降级为 `logWarn`，不影响主流程；保留 `quitting` 检查避免退出后仍安装；
- 首次安装 marketplace 的提示框保留（在异步回调内弹出）。

**验证**：desktop 编译通过；preload/first-party/market-bootstrap/plugin-recovery/usage-analytics-host 34 项测试全通过。

---

## 5.2 构建脚本深度优化（2026-08-22 新增）

**目标**：harness 自动更新最新版、本地一键快速构建、第三方不同 OS 一键构建客户端。

**改动**：
1. **harness 自动更新**：新增 `scripts/engine-update.mjs`（`pnpm engine:update` / `engine:update:stable`）——解析最新 release → 更新 engine.lock.json（ref+pinnedCommit）→ fetch → build；`fetch-engine.mjs` 现在每次 fetch 后自动固化 pinnedCommit，lock 始终反映实际 checkout。
2. **本地快速构建**：`build-clients.mjs` 增加预检（node/pnpm/git 前置失败）、显式 ref 参数支持（`pnpm build:clients <ref>`）、增量开关（`DSH_SKIP_PNPM_INSTALL`/`DSH_SKIP_FETCH`/`DSH_SKIP_ENGINE_BUILD`）、`DSH_AUTO_UPDATE_LOCK=1`、纳入根 `pnpm install`（CI 自动用 frozen-lockfile）。
3. **跨平台一键构建**：`tools/build-clients.{cmd,ps1,sh}` 统一为薄包装（环境检查+传参），业务逻辑全部收敛到 node 脚本，消除三平台逻辑漂移；`install-clients.mjs` 支持 macOS `open` dmg / Linux AppImage 启动。

**验证**：engine-update stable/latest 实跑正确（当前已是最新 rc.2）；引擎相关 16 项测试通过；build-clients 轻量验证（预检/解析/跳过/VSIX 产出）通过；全部脚本语法检查通过。

---

## 6. 决策请求

| # | 待决策项 | 建议 |
|---|---|---|
| D1 | 已实施的 3.1/3.2/3.4 修复是否保留 | 保留（根因修复，未引入新面） |
| D2 | 是否立项 3.3 官方槽迁移 | 本次不做，单独立项 |
| D3 | 既有 96 文件未提交改动如何处置 | 打包前提交固化，保证可复现 |
| D4 | 批准后立即执行 S5→S6 | — |
