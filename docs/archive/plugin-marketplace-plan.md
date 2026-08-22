# oh-my-dsh 插件市场 方案设计文档

> 文档版本：v0.3（已定稿，进入实施）
> 编制日期：2026-08-19
> 状态：**已定稿——Phase 0 验证 + Phase 1 MVP 同步实施中**
> 关联仓库：`D:\workspace\oh-my-dsh`（my-dsh 客户端包）
> v0.1 → v0.2：确立"完全兼容官方 dsh 插件体系"为最高原则，重写安装通道/识别/本体形态
> v0.2 → v0.3：① 新增 §4.8 官方命令集成（终端+图形面板，全部子命令）；② 定稿 Gate 兑底（G1 兼底优先评估内置 pnpm；G2 复刻 tsdown 管线）；③ 定稿包名 `@coeasy/dsh-plugin-marketplace`（本仓库 scope）；④ 实施范围：验证+MVP 一起做

---

## 0. 最高设计原则：完全兼容官方 dsh 插件体系

本市场**不建立任何私有的插件安装通道、目录或清单**。一切插件管理必须落在 DeepSeek Harness 官方的命令、配置与路径上：

| 维度 | 官方机制 | 本市场立场 |
|---|---|---|
| 安装/卸载/更新命令 | `dsh plugin --profile web add/remove <pkg>`（本质：profile 目录内 pnpm 转发 + bundles reconcile）| **唯一安装通道** |
| 依赖记录 | `~/.dsh/profiles/web/package.json` 的 `dependencies` | 只读展示，绝不绕过 |
| 层栈注册 | `package.json` 的 `dsh.profile.bundles`（声明 `dsh.bundle` 的依赖由官方 reconcile 进层栈）| 只读展示，绝不手写 |
| 用户补丁层 | `~/.dsh/profiles/web/cordis.patch.yml`（disable/override/insert，官方 loader 每次启动重新组合）| **唯一允许的写入点**：热启停（`- id: …` + `disabled: true/false`） |
| 技能目录 | `~/.dsh/skills/` | skill 类插件的唯一落点 |
| 预设目录 | `~/.dsh/.agent-presets/`（`preset.yml` + `agent.cordis.yml`）| agent 预设的唯一落点 |
| profile 初始化 | `dsh plugin` 首次使用时自动 init（`dsh-profile-web` 模板）| 依赖官方行为 |

**自检红线**（验收时逐条核对）：

1. 官方 `dsh plugin --profile web add` 装的插件，市场**必须**正确识别为已安装并能管理。
2. 市场装的插件，官方 `dsh plugin --profile web remove/why` **必须**能正常操作——即市场不制造"幽灵插件"（无依赖记录、不可官方管理的安装）。
3. 市场的任何操作之后，`dsh web` 用**原命令、原配置**启动，行为与官方一致；市场不留私有状态影响官方判定。
4. 手工编辑过 `cordis.patch.yml` 的用户条目，市场只读不覆盖；市场写入的条目格式与官方 patch 规范完全一致。

---

## 1. 背景与目标

### 1.1 背景

`oh-my-dsh` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的非官方客户端包（VS Code / Cursor 扩展 + Electron 桌面端），架构为"外壳"：spawn `dsh web`、加载 loopback URL、经 `--patch` 注入极简的 `@dsh/plugin-embedded-client`。

DSH 采用 Cordis 微内核、"一切皆插件"架构，但官方尚无插件市场/发现机制。本方案在客户端中开发插件市场，填补发现与管理缺口。

### 1.2 目标

让开发者从 **GitHub** 发现、浏览、安装、管理 DSH 生态插件：

- **发现策略**：自动发现（GitHub `topic:dsh-plugin`）+ 白名单（精选）结合
- **功能深度**：完整生命周期（浏览/搜索/详情 → 安装 → 更新 → 热启停 → 卸载）
- **数据架构**：纯客户端直连（静态快照 + GitHub API），无自建后端
- **落点**：混合 —— dsh web 设置页插件（主）+ 客户端壳层入口（辅）
- **兼容原则**：**完全兼容官方命令、配置与路径**（§0 最高原则）

### 1.3 成功标准

- 用户在客户端内浏览/搜索/分类/查看详情全部生态插件，零命令行完成完整生命周期管理。
- §0 的 4 条红线全部通过。
- 自动发现覆盖度 + 白名单质量保证；静态快照零限流秒开。
- 桌面端与 VS Code 端均可用。

---

## 2. 现状分析

### 2.1 oh-my-dsh 现状

| 层 | 说明 |
|---|---|
| 架构 | 外壳，spawn `dsh web` + `--patch` 注入，加载 loopback URL |
| 插件 | `plugins/embedded-client` 极简 Cordis bundle（esbuild 单文件），仅 loopback 锁定 + ready 文件 |
| 桌面端 | Electron，主界面加载 dsh web SPA；壳层：托盘、设置、窗口 chrome、手机桥、引擎更新 |
| VS Code | Webview 加载 loopback URL；命令 `dsh.open` / `dsh.stop` |
| 内核引用 | 不 fork 不 vendoring，gitignored 克隆，`engine.lock.json` 钉死 `dsh-v0.1.0-rc.8` |

关键洞察：两端主界面是**同一个 dsh web SPA**，市场做成 dsh web 设置页插件可一次覆盖两端。

### 2.2 参考项目对比与取舍

| 维度 | dsh-market/dsh-market | DSH-Plugins-Marketplace | **本方案** |
|---|---|---|---|
| 插件识别 | 精选白名单 | topic 自动发现 + adaptor | **自动 + 白名单结合** |
| 数据源 | 远程 JSON + 快照 | 静态索引 + API 兜底 | **静态快照 + API 刷新**（同左） |
| 安装通道 | **官方 `dsh plugin`**（npm tarball 优先） | 克隆 + 手动复制 + 手写 patch.yml | **严格官方通道**（同 dsh-market） |
| 已安装识别 | patch 层 + profile 实况 | 私有 `installed.json` 清单 | **官方 profile 实况**（弃私有清单） |
| 热启停 | 写官方 `cordis.patch.yml` | 不支持 | **保留**（官方补丁层，合规） |

> 取舍结论：安装与识别机制**以 dsh-market 为准**（它严格走官方通道）；发现与数据面**以 DSH-Plugins-Marketplace 为准**（自动发现 + 静态索引零限流）；其"手动复制/手写注册/执行脚本"流程**全部弃用**。

### 2.3 技术可行性（已核实）

- 内核 `dsh plugin` CLI（`apps/cli/src/plugin.ts`）：pnpm 转发器 + `reconcilePlugins` 自动把声明 `dsh.bundle` 的依赖注册进 `dsh.profile.bundles`。
- 本机 `~/.dsh/profiles/web/` 官方结构已确认：`package.json`（dependencies + dsh.profile.bundles）、`cordis.patch.yml`（用户补丁层，初始为 `[]`）、`pnpm-workspace.yaml`。
- 内核提供 client 注入机制与设置页组件（`packages/client/ui-settings-plugins` 等）。
- 热启停写 `cordis.patch.yml` 的做法已被 dsh-market 验证（HMR 约 1 秒重组，loader 每次启动重新应用）。

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     oh-my-dsh 客户端外壳                       │
│  ┌───────────────┐          ┌────────────────────────────┐   │
│  │  Electron 端   │          │      VS Code / Cursor      │   │
│  │  托盘"插件市场" │          │   dsh.marketplace.open 命令 │   │
│  └───────┬───────┘          └─────────────┬──────────────┘   │
│          │     壳层入口（B，仅跳转）          │                  │
│          └────────── spawn dsh web ─────────┘                 │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
        ┌───────────────────────────────────────────────┐
        │        dsh web（Cordis 微内核）                 │
        │  ┌─────────────────────────────────────────┐  │
        │  │  市场插件 @dsh/plugin-marketplace（A）     │  │
        │  │  host 侧：数据 / 安装 / 更新 / 启停        │  │
        │  │  client 侧：设置页 UI（client.inject）    │  │
        │  └─────────────────────────────────────────┘  │
        │  官方 profile 层（dsh-base + dsh-web-app        │
        │  + 用户经官方 CLI 安装的插件）先于 overlay 加载  │
        └───────────────┬───────────────────────────────┘
                        ▼
   GitHub API / 静态快照 / npm registry（纯客户端直连）
                        │
                        ▼
   官方安装通道：dsh plugin --profile web add/remove
        （pnpm in ~/.dsh/profiles/web + bundles reconcile）
```

### 3.1 两条线

**A. 市场插件（主功能）** —— `plugins/plugin-marketplace`（包名 `@dsh/plugin-marketplace`），**以官方方式进入用户环境**（见 §4.0），注入 dsh web：

- host 侧：registry 数据、类型识别、调用官方 `dsh plugin` 命令、patch 层热启停、已安装识别（读官方实况）。
- client 侧：经 dsh `client.inject` 把市场 UI 注入**设置 → 插件市场**页，复用内核 client 组件、主题令牌、i18n。

**B. 壳层入口（辅助）** —— 仅提供跳转，不重复实现市场逻辑：

- Electron：托盘菜单"插件市场"项 → 打开/聚焦市场页。
- VS Code：命令 `dsh.marketplace.open` + 状态栏按钮 → 聚焦市场页。

### 3.2 依赖方向（遵循现有分层规范）

```
plugins/plugin-marketplace
  ├── host：@deepseek-ai/cordis(ctx) + Node fs/child_process
  ├── client：@deepseek-ai/dsh-client-*（connection/runtime/ui-settings/locale）
  └── 禁止：vscode、electron、@dsh/client-runtime
apps/desktop、apps/vscode ──仅入口跳转──► 市场页
```

---

## 4. 核心功能设计（完整生命周期 · 官方兼容）

### 4.0 市场本体的安装与自举（关键修订）

市场自身也是普通 dsh 插件，**完全走官方通道**：

1. **发布形态**：市场发布为 **npm 包**（如 `@coeasy/dsh-plugin-marketplace`，其 `package.json` 声明 `dsh.bundle.patch` 与 `dsh.client.inject`），同时支持 GitHub git spec 安装。
2. **首启自举**：客户端首次启动检测 web profile 未安装市场时，提示用户并（确认后）执行官方命令：
   `dsh plugin --profile web add @coeasy/dsh-plugin-marketplace`
   由官方 reconcile 自动注册进 bundles 层栈。用户拒绝则市场不可用（不注入 overlay 私有通道）。
3. **自管理**：市场自身在**设置 → 插件配置**里有官方设置卡片（版本、更新、移除），更新同样走官方通道 `dsh plugin --profile web add <pkg>`（重装即更新，官方 reconcile 保证安全）。
4. **移除清理**：卸载市场时可选清理其写进 `cordis.patch.yml` 的停用行——被它停用的插件恢复运行（官方 patch 层自动回退）。

> oh-my-dsh 自身仍只用 `--patch` 注入 `embedded-client`（功能性锁 loopback，非用户可见插件），此现状不变、不冲突。

### 4.1 发现（内容/信息）

| 功能 | 说明 |
|---|---|
| 浏览列表 | 卡片流：已安装置顶，其余按 star 排序；GitHub 原链跳转 |
| 搜索 | 按插件名 / 仓库全名 / 标签实时过滤 |
| 分类 | 构建期按简介/标签自动分类 + chips 筛选（视觉/文档/记忆/开发/自动化等） |
| 详情 | 描述、README 抽取截图（仅 GitHub 图床、打开弹窗才请求）、star、许可证、更新时间、来源类型、**安装命令展示**（官方 `dsh plugin --profile web add <pkg>`，可复制）|
| 白名单徽章 | 命中精选列表打"精选"徽章，悬停显示来源 |

### 4.2 安装（官方通道 · 主路径）

所有 cordis 插件一律走官方命令，npm 包优先：

```
安装 = dsh plugin --profile web add <npm 包名 | git spec>
     （pnpm 在 profile 目录安装 → 官方 reconcile 注册 bundles → 刷新页面生效）
卸载 = dsh plugin --profile web remove <pkg>
更新 = dsh plugin --profile web add <pkg>（重装即更新）
```

- **npm tarball 优先**：插件发布了 npm 包时秒级安装；registry 数据校验 npm 包的 `repository` 指回同一仓库（防冒名，dsh-market 已验证此策略）。
- **边缘例外**（仅 git 分发、无 npm 包的插件）：允许以 **git spec** 走官方命令（`dsh plugin --profile web add github:user/repo`，pnpm 原生支持 git 依赖，仍由官方 reconcile 注册）。**绝不手动复制文件或手写注册**。
- **进度与日志**：实时展示官方命令的 stdout/stderr；失败自动重试一次，再失败展示官方日志供排查。

### 4.3 非 cordis 类型（仅官方路径）

| 类型 | 识别 | 落点（官方） | 限制 |
|---|---|---|---|
| skill | 仓库含 `SKILL.md` | `~/.dsh/skills/<name>/` | 官方目录，git clone 后仅复制技能文件，无脚本执行 |
| agent 预设 | `preset.yml` + `agent.cordis.yml` | `~/.dsh/.agent-presets/` | 同上 |
| 安装脚本类 | 仅 `install.sh/ps1` | — | **一律拒装**，提示"无官方支持路径"并附仓库链接 |

### 4.4 热启停（官方补丁层，唯一写入点）

- 启用/禁用开关写入 profile `cordis.patch.yml`：`- id: <bundle-id>` + `disabled: true|false`，格式与官方 patch 规范一致；DSH HMR 约 1 秒重组，无需重启。
- 官方基础设施 bundle（dsh-base、dsh-web-app 等模板项）禁止开关。
- 手工编辑过的补丁行显示"手工修改"徽标，只读不覆盖；patch 文件格式异常时拒绝写入（绝不写坏）。

### 4.5 已安装识别（读官方实况，零私有清单）

放弃参考项目的私有 `installed.json`，改为**每次打开市场实时比对官方状态**（多源判定，全部只读）：

1. `~/.dsh/profiles/web/package.json` 的 `dependencies`（官方依赖记录）
2. `dsh.profile.bundles` 层栈（官方注册表）
3. `node_modules` 实况 + 包名映射
4. 安装包 `repository` 字段自识别（对应 GitHub 仓库）
5. skill / preset 目录探测

版本检测：cordis 插件对比已装版本与 npm dist-tags / git HEAD（同源不误报）。

### 4.6 pnpm 前置保障（官方通道的地基）

`dsh plugin` 是 pnpm 转发器，缺 pnpm 时官方通道整体失效：

- 市场启动时检测 pnpm（`pnpm --version`）；缺失时**一键自动安装**（dsh-market 已验证此路径可行），全程零命令行。
- 安装后复检版本并在市场内展示（诊断页）。

### 4.7 Non-goals

- 自建后端 / 私有 registry；商业化；沙箱执行；脚本类插件安装；多 profile 可视化管理（仅 web profile）。

---

## 5. 插件发现机制（自动 + 白名单）

### 5.1 自动发现（覆盖度）

- 主数据：GitHub `topic:dsh-plugin` 搜索 API 分页拉取；识别标记：topic、`cordis.patch.yml`、`dsh.bundle` 声明、`SKILL.md`、`preset.yml`。
- 加速/兜底：内置**静态 registry 快照**（构建期生成，随客户端/市场包分发），优先加载（秒开、零限流），后台 API 增量刷新。

### 5.2 白名单（质量 + 安全）

- 内置 curated 精选列表（官方插件 + 社区精选，如 awesome-dsh-plugin 收录），可远程同步更新；命中打"精选"徽章。
- 排序策略：已安装置顶 → 精选其次 → star 降序（默认视图兼顾质量与覆盖度）。
- adaptor 纠正：硬编码处理不规范项目（错误条目移除、安装重定向到真实仓库，参考 adaptor.json 模式）。

### 5.3 数据流

```
启动 → 加载内置快照（离线可用）→ 秒开列表
     → 后台：GitHub API 增量刷新 + adaptor 纠正 + 白名单标注
     → 详情/截图按需请求（仅 GitHub 图床）
安装/更新/卸载 → 官方 dsh plugin 命令 → 读回官方实况刷新状态
热启停 → 写官方 cordis.patch.yml → HMR 生效
```

---

## 6. 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript | 与现有代码一致 |
| 宿主 | Cordis 插件 + dsh client 注入 | 复用官方生态原语 |
| UI | React + dsh client UI primitives | 主题令牌 `--dsw-alias-*` 深浅色自适应 |
| 构建 | esbuild + tsdown（client bundle）| 与 embedded-client / dsh-market 一致 |
| 数据 | fetch/undici + GitHub REST API + 静态快照 | 纯客户端直连；可选 `GITHUB_TOKEN` 提额 |
| 安装 | **官方 `dsh plugin` CLI**（spawn 子进程） | 最高原则 |
| 包管理 | pnpm（官方转发依赖）+ 缺失自动安装 | §4.6 |
| 测试 | vitest / node --test | 与现有栈一致 |

---

## 7. 安全设计

- **安装通道即安全边界**：只走官方命令 = pnpm 依赖解析 + 构建脚本默认禁执行（pnpm ≥10），无 `irm | iex` 式远程执行。
- **来源标注**：精选徽章 / 未验证弱提示；收录 ≠ 背书，界面明示。
- **npm 冒名防护**：registry 校验 npm 包 `repository` 指回同一仓库。
- **材料最小化**：插件所需 API Key 等仅作环境变量注入，不落盘、不采集。
- **接口边界**：安装/重启类 host 接口仅接受本机同源/环回请求，拒绝代理转发；进程管理器托管（systemd/launchd/pm2）时禁用一键重启。
- **补丁层写安全**：格式校验通过才落盘，失败自动回滚；绝不覆盖手工条目。

---

## 8. 落地路径（分期）

### Phase 0 — 可行性验证（2 天）★ Gate

> 机制事实（已读内核源码 `packages/client/modules/src/index.ts` 确认）：host 侧 `dsh-client-modules` 服务扫描 loader 全部 entries → 找声明 `dsh.client` 的包 → 读其 `package.json` `exports["./client"]` → webserver 提供 `/plugins/<id>/client.js` → 浏览器侧 client.js 经 `window.__ModuleLoader__.load({id, factory})` 注册懒 CJS 工厂（React 等由壳模块系统提供，跨插件值导入为构建错误）。**v0.2 决策（市场本体走官方 npm 安装进 profile node_modules）已天然满足扫描前提**——原“esbuild 单文件注入不可用”风险大部分消解，Gate 从“能不能”变为下列 6 个具体问题。

#### G1. 官方通道在客户端 runtime 环境端到端可用吗？（最高优先）

**问题**：oh-my-dsh 打包形态（NSIS/portable/zip）内置的是可搬迁 runtime（`node.exe + dsh.cmd + harness/`），`dsh plugin` 需要在此环境内找到 pnpm 并成功执行 profile 目录内的安装。未验证。
**验证方法**：在打包后的 portable 版里执行 `dsh plugin --profile web add dshmarket`（借真实插件），确认：profile init → pnpm 安装 → bundles reconcile → `dsh web` 重启后插件生效，四步全通。
**方案**：A（主）验证通过即按 §4.2 实施；B（兜底）若打包 runtime 缺 pnpm 且自动安装受限（网络/权限），在安装包 Phase 3 评估内置 pnpm；C（保底）把官方命令执行改为提示用户在外部终端执行（体验降级，但官方兼容红线不破）。

#### G2. client bundle 的正确构建形态（tsdown 运行时包，非 esbuild 普通打包）

**问题**：市场 client 代码必须构建为“注册懒 CJS 工厂”的运行时包（`window.__ModuleLoader__.load`，React 等外部化），现有 `compile:plugin` 的 esbuild 普通打包**不适用**。需复刻 dsh-market 的构建管线（tsdown + banner 规范化，其 `client/client.js` 即此形态）。
**验证方法**：在内核克隆上以 dsh-market 为参照，搭最小 client 插件（仅一个设置卡片），tsdown 构建 → 官方安装 → `dsh web` 中出现该卡片。
**方案**：A（主）新建 `plugins/plugin-marketplace/tsdown.config.ts`，pipeline 对齐 dsh-market（含 `normalize-client-banner` 步骤）；B（备选）直接 fork dsh-market 构建脚本裁剪。**无论 A/B，均不改动 embedded-client 现有 esbuild 流程**（两者形态不同互不影响）。

#### G3. 设置页 UI 插入机制（settings 卡片/分区如何注册）

**问题**：市场 UI 要出现在“设置 → 插件市场”，依赖内核 `dsh-settings` 契约与 `ui-settings-plugins` 组件（dsh-market 以 peerDependency `@deepseek-ai/dsh-settings` 声明，可选）。具体注册 API（配置卡声明 vs 代码注入）需实测确认。
**验证方法**：读内核 `packages/settings` + dsh-market `SettingsCard.tsx`，用最小插件验证两种路径：a) 纯声明式配置卡；b) 代码注入完整 React 分区（市场需要 b）。
**方案**：以 dsh-market 的 `SettingsCard.tsx` + `inject` 列表为蓝本实现；宿主过旧缺原语时市场自我禁用（dsh-market 模式）。

#### G4. 开发期迭代循环（workspace → 官方 profile 的热更新）

**问题**：市场插件开发时需频繁改代码看效果；直接改 profile node_modules 里的包违反“官方通道”精神且会被 pnpm 覆盖。
**方案**：A（主）用官方命令装本地包：`dsh plugin --profile web add file:D:/workspace/oh-my-dsh/plugins/plugin-marketplace`（pnpm 原生 file: spec，官方 reconcile 按 true package name 注册——内核 plugin.ts 注释已明确支持）；改代码后 `dsh plugin --profile web add <file:spec>` 重装，或配合内核 HMR（`pnpm dsh web` + `dev:web`，vite 配置已注释此路径）。B（辅）`pnpm link` 方式（非官方推荐）。**交付形态不受影响**：发布走 npm，用户侧始终官方安装。

#### G5. 依赖解析与版本门控

**问题**：市场包的 peerDeps（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-settings` 等）在用户 profile 中由 dsh-base 层栈提供；版本不匹配（用户引擎 rc.6 vs 市场 rc.7 编译）会缺原语。
**方案**：peerDeps 宽松声明（`^0.1.0-rc.8`）；启动时能力探测（缺原语自我禁用 + 控制台说明，dsh-market 同款策略）；oh-my-dsh 引擎钉死 rc.8 与市场开发基线一致。

#### G6. 壳层入口与市场页跳转（辅线）

**问题**：Electron/VS Code 壳层需打开“设置→插件市场”页——dsh web SPA 的深链（URL hash/路由）是否支持直达设置子页未验证。
**验证方法**：检查 web SPA 路由是否暴露 settings 深链；dsh-market 无此需求（用户手动进入）。
**方案**：A（主）若深链存在，壳层直接导航；B（备选）壳层仅打开 SPA 首页 + 提示路径；C（增强）市场插件提供 host 接口 `market.open`，壳层经 loopback 调用后由 client 侧自行导航（同源限制内）。

#### Gate 判定标准

- **硬门槛**：G1 + G2 通过（官方通道端到端 + client 构建形态）→ 进入 Phase 1。
- G1 失败 → 启动 B/C 兜底评估，不阻塞 Phase 1 的开发（发现/浏览/数据层先行）。
- G2/G3 失败且无解 → 壳层独立 UI 备选（功能等价，体验降级，官方兼容红线仍由数据/安装层保住）。
- G4–G6 属工程问题，失败不阻塞 Gate，降级处理。

### Phase 1 — MVP（发现 + 官方安装）
- 市场插件骨架（host + client inject）+ 设置页入口。
- 浏览/搜索/分类/详情（内置快照 + API 刷新）+ 白名单徽章。
- 官方通道安装 cordis 插件（npm 优先 + git spec 例外）+ 已安装识别（读官方实况）。
- 首启自举流程（检测 → 确认 → 官方安装市场本体）。
- pnpm 检测与自动安装。

### Phase 2 — 完整生命周期
- 更新（版本检测 + 一键更新）、卸载、热启停（官方 patch 层）。
- skill / preset 类型支持（官方目录）。
- adaptor 纠正、市场自管理设置卡片、i18n 双语。

### Phase 3 — 壳层入口 + 打磨
- Electron 托盘入口 + VS Code 命令/状态栏。
- 诊断页（加载顺序/冲突）、导出脱敏日志、快照离线兜底完善。
- 兼容性回归：官方 CLI 与市场交叉操作（官方装→市场识别；市场装→官方卸载）双向测试。

---

## 9. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| G1 官方通道在打包 runtime 内不可用（pnpm 缺失/受限） | 高 | Phase 0 硬门槛；兜底：内置 pnpm（Phase 3）→ 提示外部终端执行；不破官方兼容红线 |
| G2 client bundle 构建形态错误（非懒 CJS 工厂包） | 高 | Phase 0 硬门槛；对齐 dsh-market 的 tsdown 管线；不影响 embedded-client 现有流程 |
| G3 设置页插入原语缺失/版本过旧 | 中 | 能力探测 + 自我禁用（dsh-market 模式）；oh-my-dsh 引擎钉 rc.8 同基线 |
| G6 SPA 无设置深链，壳层入口降级 | 低 | 主用深链，备选首页+提示，增强方案 host 接口导航 |
| pnpm 自动安装失败（网络/权限） | 中 | 失败时展示手动指引；安装包形态可考虑预装（Phase 3 评估）|
| GitHub API 限流 | 中 | 静态快照优先 + 缓存 + 可选 token |
| git spec 安装慢（无 npm 包的插件） | 低 | 明示"取决于网络"；进度反馈 |
| 市场本体 npm 包与内核版本耦合（rc 变动） | 中 | peerDependencies 宽松声明 + engine.lock 钉死 + 兼容性测试；宿主太旧时市场自我禁用（dsh-market 模式）|
| 写 `cordis.patch.yml` 与用户手工编辑冲突 | 中 | 保守合并策略 + 徽标提示 + 格式校验回滚 |
| 第三方插件质量参差 | 中 | 白名单徽章 + 排序策略 + 未验证提示 |

---

## 10. 验收标准（红线优先）

官方兼容红线（§0）：
- [ ] 官方 CLI 装的插件，市场识别为已安装且可管理
- [ ] 市场装的插件，官方 `dsh plugin remove/why` 正常操作（无幽灵插件）
- [ ] 市场任何操作后，`dsh web` 原命令原配置启动行为一致
- [ ] 手工 patch 条目不被覆盖；市场写入条目符合官方规范

功能：
- [ ] 两端可浏览/搜索/分类/详情；静态快照离线秒开（零 API 调用）
- [ ] 官方通道一键安装 cordis/skill/preset 成功并识别已安装
- [ ] 版本不一致显示"更新"，一键更新成功
- [ ] 卸载确认；热启停 1 秒内生效无需重启；基础设施 bundle 禁止开关
- [ ] 市场本体经官方命令安装/更新/移除；首启自举流程完整
- [ ] 缺 pnpm 时一键自动安装成功
- [ ] 精选徽章 / adaptor 重定向生效；脚本类插件被拒并提示
- [ ] `pnpm verify` 通过

---

## 11. 已定稿决策记录（2026-08-19）

1. **包名与发布**：`@coeasy/dsh-plugin-marketplace`，本仓库（coeasy/oh-my-dsh）scope，CI 复用现有 release 流水线。
2. **白名单数据源**：人工内置起步，支持远程同步（awesome-dsh-plugin 可作为同步源）。
3. **预装策略**：当前首启自举；若 G1 验证发现打包 runtime 内 pnpm 受限，Phase 3 优先评估安装包内置 pnpm + 预装市场。
4. **`GITHUB_TOKEN`**：放市场设置卡片（与市场数据刷新同处），客户端壳层不重复入口。
5. **官方命令集成**：见 §4.8。

---

## 12. 官方命令集成（v0.3 新增，客户端能力扩展）

客户端从"纯外壳"升级为"官方 CLI 的图形化宿主"：用户在客户端内即可使用全部官方 `dsh` 命令。

### 12.1 交互形态：终端 + 图形面板（双轨）

| 轨道 | 形态 | 覆盖 |
|---|---|---|
| **终端面板** | 内嵌终端（Electron 内 xterm.js + node-pty；VS Code 天然用集成终端）| **全部子命令**（所见即官方，含未图形化的命令）|
| **图形面板** | 命令面板 UI：常用命令按钮 + 参数表单 + 实时输出/进度 | 常用命令：`plugin add/remove/why`、`web --dump-config`、profile 管理、市场操作 |

### 12.2 实现要点

- **命令执行层**（共享）：两端底层同一执行器（spawn 官方 dsh 可执行文件，cwd/环境对齐 profile），输出实时回流；插件市场的安装/更新/卸载也复用此执行器（§4.2），**单一事实源**。
- **终端面板**：Electron 主进程 node-pty → renderer xterm.js；VS Code 扩展直接复用集成终端（vscode.tasks / createTerminal + shellIntegration 执行 dsh）。命令历史/补全（读官方 help 动态生成子命令提示）。
- **图形面板**：命令注册表（命令模板 + 参数 schema），首期内置常用命令；架构上预留"从市场插件注册新命令面板"的扩展点。
- **dsh 可执行定位**：复用 client-runtime 现有解析链（PATH / bundled / stage / clone），暴露为 `dsh.exec` 能力。
- **安全**：命令面板仅暴露官方命令白名单模板；终端面板为完整 shell（用户自己负责，与官方终端体验一致）；输出展示前脱敏（密钥形状打码）。

### 12.3 分期

- **Phase 1**：共享执行器 + Electron 内嵌终端面板（最小可用：xterm.js + node-pty + dsh PATH 解析）+ VS Code 集成终端命令。
- **Phase 2**：图形命令面板（常用命令表单化）+ 命令历史/补全。
- **Phase 3**：命令面板扩展点 + 输出脱敏完善 + 快捷指令市场联动（浏览插件→复制安装命令→终端执行）。

---

*v0.3 已定稿，Phase 0 验证与 Phase 1 MVP 实施中。*


---

## 附录 A：Phase 0 Gate + MVP 验证报告（2026-08-19 实测）

### Gate 结果：G1–G4 全部通过，无需任何兜底

| 项 | 结果 | 证据 |
|---|---|---|
| **G1** 官方通道端到端 | ✅ 通过 | 打包 runtime（`runtime/payload/dsh.cmd`）内执行 `dsh plugin --profile web add dshmarket`：profile init → pnpm 安装 → **官方 reconcile 自动注册进 `dsh.profile.bundles`** → `dsh web` 中 `/plugins/dshmarket/client.js` 返回 200、boot manifest 注入 index |
| **G2** client bundle 形态 | ✅ 通过 | 自研 `coeasy-dsh-market` 经 tsdown 构建出懒 CJS 工厂（`window.__ModuleLoader__.load({ id, factory })`），webserver 正常分发 |
| **G3** 设置页插入机制 | ✅ 通过 | 机制确认：client 侧 `ctx.slots.inject('settings.section', …)` + `slots.register({id, order, label}, Component)`；host 侧 `webServer.register({kind, path, handler})` |
| **G4** 本地开发迭代 | ✅ 通过 | `dsh plugin --profile web add file:<path>` 官方安装本地包，reconcile 按包名注册；注意 pnpm 按版本号去重，改代码后需 remove+add |
| G5/G6 | 未阻塞 | 工程细节，Phase 1/3 处理 |

### 重要发现（实证了方案既有设计）

1. **pnpm 解析依赖环境 PATH**（§4.6 必要性实证）：`dsh plugin` 内部 spawn pnpm，PATH 不含 pnpm 时官方通道失败（`'pnpm' 不是内部或外部命令`）。市场插件的 pnpm 检测/自动安装/PATH 补全逻辑必须落地（dshmarket 的 pnpm-compat.ts 同样印证）。
2. **snapshot 路径解析陷阱**：esbuild bundle 内 `createRequire(...).resolve('./package.json')` 相对锚点目录解析会错位；正确做法是 `dirname(fileURLToPath(import.meta.url)) + '../data/…'`（已修复）。
3. **file: 安装的更新语义**：pnpm 对同版本号 file: 依赖跳过重新复制；开发循环需 remove + add 或升版本号。

### MVP 交付物（已在本机官方 profile 中端到端运行）

```
plugins/plugin-marketplace/            # npm 包 coeasy-dsh-market v0.1.0
├── package.json                       # dsh.bundle + dsh.client 声明，exports["./client"]
├── cordis.patch.yml                   # 官方注册模板（id: coeasy-market）
├── tsdown.config.ts                   # 懒 CJS 工厂构建（banner/footer + externals）
├── data/registry-snapshot.json        # 内置快照：60 个插件（star 排序，含 pkg_name/npm 映射）
├── src/
│   ├── index.ts        # host：4 条 webServer 路由（list/install/remove/status）
│   ├── registry.ts     # 快照 + GitHub topic 刷新 + 白名单/adaptor/排除表 + 官方实况读取
│   ├── install.ts      # 官方命令执行器（重调启动 host 的 dsh CLI；npm 名优先，github: spec 兜底）
│   └── client/index.ts # client：settings.section 注册 + 市场 UI（搜索/列表/精选徽章/安装/移除/命令输出）
├── lib/index.js         # host bundle（esbuild，无运行时外部依赖）
└── client/client.js     # client bundle（tsdown 懒 CJS 工厂，react external）
```

### 红线自检（§0）当前状态

- ✅ 官方装的插件被市场识别（dshmarket installed=true）
- ✅ 市场装的插件可被官方 remove（本机 remove coeasy-dsh-market 成功执行过）
- ✅ 安装只写官方 dependencies + bundles，`cordis.patch.yml` 保持 `[]` 未污染
- ✅ 已装判定零私有清单（实时读 profile package.json）

### 验证时本机 profile 状态

`~/.dsh/profiles/web` 现含 `dshmarket@1.11.3`（npm）与 `coeasy-dsh-market`（file: 本地包）两个市场实现，均经官方通道安装，可直接 `dsh web` 体验对比。


---

## 附录 B：内置市场 + 退出无残留 对齐实现（2026-08-19）

### 决策记录
| 项 | 决策 |
|---|---|
| 内置加载 | **profile 预装**：市场随客户端打包（`scripts/copy-market.mjs` → `resources/plugin-marketplace`），首启自举 `dsh plugin add file:<内置路径>` 装进官方 profile，之后启动已装即用，零用户操作 |
| 卸载边界 | 卸载 = 官方 `dsh plugin remove`；**卸载后命令行 `dsh plugin add @coeasy/dsh-plugin-marketplace` 仍可装** |
| 退出收割 | **强收割**：退出时除收割引擎树外，扫描 commandline 匹配 `plugin-marketplace`/`plugin --profile`/`bin.js` 的进程逐一 `taskkill /F`（`killMatchingProcesses`），堵住 detached/reparented 孤儿漏杀 |
| 内置 vs 命令行 | **命令行优先**：`isMarketInstalled()` 检测官方 deps，已装则跳过内置注入；内置仅兜底 |
| 不自动装回 | settings 记 `marketEverInstalled`/`marketUserRemoved`：用户卸载（或 CLI remove）后**不再自动装回**，尊重删除 |
| 卸载入口 | **仅命令行** `dsh plugin --profile web remove @coeasy/dsh-plugin-marketplace`（不加客户端内入口）；卸载后命令行仍可装回 |
| 打包验证 | **暂停**：完整打包被 win-unpacked 目录锁阻塞（杀软扫描 208MB，无进程占用），由维护者在合适时机运行 `build-clients`；源码与内置包链路已分别验证 |

### 实现清单
- `packages/client-runtime/src/shutdown.ts`：新增 `killMatchingProcesses(patterns)`（Windows wmic 枚举 + 匹配 + taskkill /T /F；POSIX pkill）
- `apps/desktop/src/market-bootstrap.ts`：`installMarket(dshCommand, marketPath)` 用 `file:` 内置路径；`track()` 记录自举子进程；`killBootstrapProcesses()` 退出收割
- `apps/desktop/src/main.ts`：`quitAll` 集成强收割 + 自举进程收割；首启自举加入删除标记判断（首次装 / 曾装缺失→记删除不装回 / 已删除→不装）
- `apps/desktop/src/desktop-settings.ts`：新增 `marketEverInstalled`/`marketUserRemoved` 持久化
- `scripts/copy-market.mjs` + `electron-builder.yml`：内置市场打包进 `resources/plugin-marketplace`（不含 node_modules/src），`compile:desktop` 自动执行

### 验证
- ✅ 内置包（`out/plugin-marketplace`）经官方 CLI 安装成功，`deps`+`bundles` 注册正确（命令行优先去重生效）
- ✅ 桌面端类型检查通过；`compile:desktop` 生成内置市场产物
- ⚠️ **完整打包被环境文件锁阻塞**（`win-unpacked` EPERM，疑杀毒扫描 208MB 目录，无进程占用，已重试 3 次）——待处理
