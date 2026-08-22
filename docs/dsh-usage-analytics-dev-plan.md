# my-dsh Usage Analytics 插件详细开发方案

> 文档版本：2.0.0-dev-plan
> 依据：[dsh-usage-analytics-final-plan.md](./dsh-usage-analytics-final-plan.md)（1.0.0-final 实施基线）
> 日期：2026-08-21
> 状态：开发实施计划（映射到当前仓库实际结构）

## 0. 当前仓库现状与方案映射

本方案基于对仓库的实际审计结果制定，与最终方案的模块对应关系：

| 最终方案概念 | 仓库现状 | 差距 |
|---|---|---|
| 插件商城安装 | `plugins/plugin-marketplace`（dsh CLI + pnpm spec，GitHub registry snapshot） | 已有安装/卸载/校验/备份链路，缺 usage-analytics 插件条目 |
| Cordis 插件运行时 | `plugins/embedded-client` 展示了 Cordis function plugin 模式 | usage-analytics 需要新增一个 Cordis 插件 |
| Plugin Host API | 暂无 `plugin.host.v1` 版本化接口层 | **主要缺口**，需在 Cordis 服务层补最小桥接 |
| 跨端 App | `apps/desktop`（Electron）、`apps/vscode` | Web 端首期降级为 desktop 内嵌 webview 复用 |
| 客户端运行时 | `packages/client-runtime`（spawn/loopback/parse 等） | 需新增观测事件出口 |

**关键实施决策**：

1. 采集端以 **Cordis 插件**形态开发（与 embedded-client 同模式），而非独立进程——这样天然获得“不改上游 Harness”的能力：Cordis 插件通过服务注入订阅事件，不修改 Harness 源码。
2. Plugin Host API 以 **Cordis service + 版本化接口对象**实现（`ctx.usageAnalytics`），接口定义放在独立 npm 包 `packages/usage-protocol` 供插件与宿主共享类型。
3. UI 采用共享 Bundle（Preact/Svelte 均可，选型见 §6），Desktop 用 Electron webview / BrowserWindow 挂载，VS Code 用 Webview 挂载，两端只写 Host Bridge。
4. 存储统一用 `better-sqlite3`（Desktop/VS Code，Node 侧）+ Web 端 fallback 到 IndexedDB 适配器（首期 Web 非验收目标，接口预留）。

## 1. 目标与范围

**范围**：实现 `com.my-dsh.usage-analytics` 插件从 0 到商城发布的全链路，包括：

- 采集：订阅 Cordis 层请求/响应事件，产出 `usage.event.v1`
- 统计：标准化、去重、流式合并、重试归并、每日聚合
- 存储：插件独立 SQLite，181 天保留策略
- 查询：统一 Query API
- UI：一套共享 Bundle，Desktop + VS Code 两端 Host Bridge
- Provider：内置模板 + 声明式 JSONPath 映射
- 发布：签名、商城条目、更新回滚

**不做**（与最终方案 §2.2 一致）：任意 JS Provider 适配、Loopback 代理采集、默认联网取价、修改上游 Harness。

## 2. 代码结构

新增 workspace 成员：

```
packages/
  usage-protocol/            # 共享类型与协议（无运行时依赖）
    src/
      event.ts               # usage.event.v1 类型 + zod schema
      query.ts               # Query API 请求/响应类型
      host-api.ts            # UsagePluginHostV1 接口定义
      errors.ts              # 错误类别枚举
      quality.ts             # data_quality 枚举
    tests/

plugins/
  usage-analytics/           # Cordis 采集插件（Node 侧）
    src/
      index.ts               # Cordis 插件入口，注册 ctx.usageAnalytics 服务
      observer.ts            # 订阅请求/SSE 事件 → RawObservedEvent
      normalizer.ts          # RawObservedEvent → usage.event.v1
      dedupe.ts              # logical/attempt 去重与流式合并
      aggregator.ts          # 每日聚合（后台任务）
      retention.ts           # 181 天清理
      pipeline.ts            # 内存队列 + 批量写
      host-api.ts            # 实现 UsagePluginHostV1 并挂到 Cordis ctx
    tests/
      fixtures/              # Provider 响应样本（脱敏 JSON）

packages/
  usage-analytics-core/      # 纯函数统计核心（跨端共享，无 Node 依赖）
    src/
      mapping.ts             # JSONPath/JSON Pointer 声明式映射引擎
      pricing.ts             # 版本化价格表与费用估算
      aggregate.ts           # 聚合计算（供查询层复用）
      cache-metrics.ts       # 缓存请求指标口径
      unknown.ts             # unknown 传播规则
    tests/

packages/
  usage-analytics-ui/        # 共享 UI Bundle
    src/
      app.tsx                # 入口，按 route 渲染
      routes/
        overview.tsx
        providers.tsx
        sessions.tsx
        settings.tsx
      bridge.ts              # Host Bridge 接口（注入式，不 import 平台 API）
      components/            # QualityBadge、UnknownCell、FilterBar、图表组件
    tests/

apps/desktop/src/plugins/usage-analytics-bridge.ts
apps/vscode/src/plugins/usage-analytics-bridge.ts
```

**分层规则**（与仓库 `scripts/layer-audit.mjs` 对齐）：

- `usage-protocol`：零依赖，仅类型 + zod
- `usage-analytics-core`：只依赖 `usage-protocol`
- `usage-analytics`（Cordis 插件）：依赖 protocol + core + better-sqlite3
- `usage-analytics-ui`：只依赖 protocol + Query API 类型，通过 `bridge.ts` 注入平台能力
- apps 只实现 bridge，不复制业务逻辑

## 3. Phase 0：插件能力审计（1 周）

### 任务清单

| # | 任务 | 验证方式 | 产出 |
|---|---|---|---|
| 0.1 | 审计 Cordis 层可订阅的请求/响应事件（chat request、SSE chunk、final usage） | 在 embedded-client 模式下写临时探针插件，dump 事件名和 payload 形状 | 事件目录 `docs/analytics/observable-events.md` |
| 0.2 | 确认事件中是否含 logical request/session/turn 标识 | 同上 | ID 可关联性结论 |
| 0.3 | 审计 `plugin-marketplace` 的 manifest 校验规则（是否支持 targets/permissions 字段扩展） | 读 `verify.ts` + registry.ts | 字段扩展清单 |
| 0.4 | 审计 `apps/desktop` / `apps/vscode` 的 webview 挂载点 | 现有 UI 入口代码 | 挂载点清单 |
| 0.5 | 确认 better-sqlite3 在 Electron/VS Code 打包下的 native 模块兼容性（electron-rebuild / vsce） | 各端编译冒烟 | 兼容性结论，必要时改用纯 JS 的 `sql.js` + 落盘 |
| 0.6 | 输出 Capability Matrix 与缺口清单 | 评审 | `docs/analytics/capability-matrix.md` |

### Phase 0 关键判定点

- **观测事件是否够用**：若 Cordis 层拿不到最终 usage（例如只有原始 SSE 文本），则 Observer 需要在 Cordis 插件内做 SSE 尾部解析（仍在插件内，不修改 Harness）；若完全无事件出口，升级为“先给客户端补事件发射”的最小改动，范围限定在插件宿主层。
- **SQLite 可用性**：不可用则切 `sql.js`（纯 WASM），接口不变，性能预算放宽到 20ms/事件。

## 4. Phase 1：插件骨架与生命周期（1.5 周）

### 4.1 Manifest（扩展 plugin-marketplace 现有校验）

```json
{
  "id": "com.my-dsh.usage-analytics",
  "name": "Usage Analytics",
  "version": "0.1.0",
  "api_version": "plugin.host.v1",
  "targets": ["desktop", "vscode"],
  "permissions": ["usage.observe", "storage.local", "ui.mount", "events.subscribe"],
  "cordis_entry": "dist/index.js",
  "ui_entry": "ui/bundle.js",
  "schema_version": 1
}
```

- `plugin-marketplace/src/verify.ts` 增加 `api_version`、`targets`、`permissions` 字段校验（向后兼容：缺失这些字段的旧插件仍可通过）。
- 安装沿用现有 `dsh plugin --profile` 官方链路，不另建安装通道。

### 4.2 状态机

在插件存储 `plugin_settings` 中持久化状态，状态迁移与最终方案 §3.2 一致：

```
installed(disabled) → enabling → enabled(collecting) ⇄ disabled(data kept)
enabled → upgrading → enabled'（失败自动 rollback）
任意状态 → uninstalling → {uninstalled(keep data) | uninstalled(purge data)}
```

- 启用 = 初始化 DB + 迁移 + 注册 observer；禁用 = 取消订阅 + flush 队列 + 关 DB，数据保留。
- 插件 Cordis 入口加载即注册服务，但 **只有 enabled 状态才 subscribe**，满足“安装后默认不采集”。

### 4.3 交付物与验收

- 插件可经 marketplace / 本地包安装，显示“已安装/未启用”
- 状态页（最小 UI：状态 + 启停按钮 + 数据保留选择）
- 生命周期单测（沿用 `plugins/plugin-marketplace/tests` 模式）：安装/启用/禁用/卸载各路径
- 卸载后 `apps/desktop`、`apps/vscode` 冒烟仍通过

## 5. Phase 2：观测桥与 usage.event.v1（2 周）

### 5.1 Observer 设计

```
Cordis 事件（chat.request / sse.chunk / chat.completion / error）
        ↓ Host 侧脱敏投影（白名单字段）
SafeObservedEvent
        ↓ 插件 observer.ts
RawObservedEvent（含原始 usage JSON，仅内存）
        ↓ normalizer + mapping
usage.event.v1 → 队列 → SQLite（不落原始 JSON）
```

**脱敏投影在 Host 侧完成**（最终方案 §5.3），白名单：

- `logical_request_id / attempt_id / session_id / turn_id`
- `provider_id / model_id / base_url_host`
- `http_status / error_code`
- `started_at / completed_at`
- `usage` 子树（仅提取映射后字段，原始 JSON 不透传给持久层）
- **绝不包含**：headers、authorization、prompt、response 正文、API key

### 5.2 事件生成规则

- `logical_request_id`：优先取客户端已有请求 ID；无则 Host 生成并标记 `derived`
- `attempt_id`：每次实际网络尝试分配；重试共用 logical ID
- 流式：首个 chunk 建 in-flight 记录 → 最终 usage / done / error / abort 时提交一次；中断无 usage 则 token 全 unknown，不累计中间估算
- 去重键：`logical_request_id + attempt_id + source`，重复事件直接丢弃（幂等）

### 5.3 zod schema（usage-protocol/src/event.ts）

按最终方案 §6.1 逐字段定义，数值字段类型为 `number | null`（null=unknown），`data_quality` 为字段级枚举 `exact | estimated | derived | unknown`。schema 同时用于：Host 侧校验产出、插件侧校验入库、UI 侧类型推导。

### 5.4 验收

- 真实客户端跑一轮对话（含流式），DB 中出现正确关联的 events
- 单测：注入含 Authorization 头的原始事件，断言投影后无泄漏字段
- 性能：单事件处理 < 10ms（不含 DB 批量写延迟）

## 6. Phase 3：统计 Core 与存储（2 周）

### 6.1 SQLite Schema（v1）

```sql
-- migration 001_init.sql
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  logical_request_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  session_id TEXT, turn_id TEXT,
  provider_id TEXT NOT NULL, model_id TEXT,
  observed_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
  status TEXT NOT NULL, http_status INTEGER, latency_ms INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
  total_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER, cache_creation_tokens INTEGER,
  cost_value REAL, cost_currency TEXT,
  data_quality_json TEXT NOT NULL,   -- 字段级质量映射
  source TEXT NOT NULL, error_category TEXT,
  pricing_id TEXT, pricing_version TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_time ON usage_events(observed_at);
CREATE INDEX idx_events_logical ON usage_events(logical_request_id, attempt_id);
CREATE INDEX idx_events_session ON usage_events(session_id);

CREATE TABLE usage_daily (
  date TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
  request_count INTEGER, attempt_count INTEGER,
  success_count INTEGER, error_count INTEGER, unknown_status_count INTEGER,
  input_tokens_exact INTEGER, input_tokens_unknown_count INTEGER,
  output_tokens_exact INTEGER, output_tokens_unknown_count INTEGER,
  cache_read_tokens_exact INTEGER, cache_write_tokens_exact INTEGER,
  cache_creation_tokens_exact INTEGER, cache_status_unknown_count INTEGER,
  estimated_cost_value REAL, cost_currency TEXT,
  PRIMARY KEY (date, provider_id, model_id)
);

CREATE TABLE provider_profiles (id TEXT PRIMARY KEY, match_json TEXT, mapping_json TEXT, updated_at INTEGER);
CREATE TABLE pricing_versions (id TEXT, version TEXT, currency TEXT, prices_json TEXT, PRIMARY KEY(id, version));
CREATE TABLE mapping_profiles (id TEXT PRIMARY KEY, body TEXT, created_at INTEGER);
CREATE TABLE plugin_settings (key TEXT PRIMARY KEY, value_json TEXT);
```

说明：

- Token 列 `NULL = unknown`，**禁止写 0**；聚合表为 exact 累计 + unknown 计数分列，保证“未知不当 0、也不当命中”。
- 缓存指标口径实现于 `usage-analytics-core/src/cache-metrics.ts`：`cache_read_requests` = `cache_read_tokens IS NOT NULL AND > 0` 的逻辑请求数；`cache_status_unknown` 单列。
- 禁止字段（prompt_raw 等）由入库层 zod schema 反向校验：多余字段直接拒绝整条事件并记 `parse_error`。

### 6.2 迁移机制

- `schema_migrations` 表 + 编号 SQL 文件，每次迁移在事务内执行
- 迁移前 `VACUUM INTO` 备份到 `backups/pre-migrate-<version>.db`
- 更新流程：新版插件启动失败 → 恢复备份 + 回滚到旧版入口（沿用 `plugin-marketplace/src/backup.ts` 思路）

### 6.3 写入管线

```
事件 → 有界内存队列（默认 512 条，约 1MB）
     → 每 500ms 或 64 条批量事务写入
     → 写失败：重试 3 次 → 仍失败则丢入 dead-letter 表 + UI 告警，绝不阻塞主流程
```

- 队列满时丢弃新事件并自增 `dropped_events` 计数（设置页显示告警），不影响聊天。
- 聚合：写入事务内同步 UPSERT 当日 `usage_daily`，查询默认只读聚合表。

### 6.4 保留策略

- 后台每日一次：删除 `observed_at < now - retention_days` 的明细（默认 181 天），聚合保留
- 删除前 UI 显示将删除的时间范围与条数，需确认
- `VACUUM` 限空闲时执行，避免锁库

### 6.5 验收

- 同一 logical request 重试 3 次：`request_count=1`、`attempt_count=3`、Token 只计最终成功 attempt
- 流式重复 final usage 事件：幂等，不双计
- 181 天清理单测 + 迁移/回滚单测

## 7. Phase 4：Provider 声明式映射（1.5 周）

### 7.1 映射引擎（usage-analytics-core/src/mapping.ts）

- 输入：Provider 映射配置（结构同最终方案 §9.2）+ usage JSON
- 路径语法：仅支持受限 JSONPath 子集（`$.a.b[0].c`、`$..cached_tokens`），实现自研 ~100 行解析器，**不引入完整 jsonpath 库**（减少攻击面），路径先过格式 zod 校验
- 候选路径按序尝试，首个解析成功且为非负数者生效；全失败 → 字段 unknown + `invalid_mapping`/`missing_usage` 错误类别
- 映射配置 zod schema 强校验，禁 unknown key；`match.base_url_pattern` 限主机名 glob

### 7.2 内置模板

首批内置（每个配 fixtures）：openai-compatible、deepseek、anthropic-compatible（cache_creation/cache_read 字段）、gemini-compatible（usageMetadata）。模板只读，用户基于模板克隆改。

### 7.3 映射测试工具

设置页内嵌“映射测试器”：粘贴脱敏样例 JSON → 实时预览归一化结果 + 质量标记 + 错误类别。纯前端调用 core 引擎，不发起网络请求。

### 7.4 验收

Fixture 矩阵（每个 Provider 8 类：成功/流式成功/无 usage/缓存读/缓存写/错误/截断/重试，见最终方案 §17.2）全部通过；用户仅通过 JSON 配置即可接入新 Provider。

## 8. Phase 5：共享 UI（2.5 周）

### 8.1 技术选型

- **Preact + htm**（无构建时 JSX 依赖可选）或 Svelte 5；倾向 **Preact**：产物小（<12KB gz）、可与 esbuild 单文件打包、无运行时编译
- 图表：轻量自绘 SVG 折线/柱状组件（避免引入 ECharts 全量）；若需求升级再评估 uPlot（~35KB）
- 构建：esbuild 单 bundle `ui/bundle.js`，注入全局 `__USAGE_HOST_BRIDGE__`

### 8.2 Bridge 契约

```ts
interface UIBridge {
  query: (req: QueryRequest) => Promise<QueryResponse>;
  subscribe: (topic: string, cb: (p: unknown) => void) => () => void;
  getCapabilities: () => { costEstimation: boolean; exportFormats: string[] };
  openRoute: (route: string) => void;   // 平台导航（desktop 窗口 / vscode panel）
}
```

- Desktop bridge：`preload.ts` contextBridge 暴露 IPC → 主进程调用插件 Query API
- VS Code bridge：`acquireVsCodeApi()` postMessage → extension host 转发
- UI 内 **禁止** 直接 fetch / 访问 localStorage 存敏感项

### 8.3 页面实现顺序

1. 总览（今日请求/Token/缓存次数/错误率/P50/P95；费用卡片默认隐藏，开关记忆在设置）
2. Provider/Model 分析（含缓存使用与估算费用）
3. Session/Turn 详情（分页明细，时间线）
4. 缓存分析（命中率只对已知缓存数据计算）
5. 设置（启停、费用估算、主货币、映射管理+测试器、价格表覆盖、保留期、导出 CSV/JSON、清空、权限状态、丢弃事件告警）

### 8.4 unknown 视觉规范

- unknown 单元格：显示 `—` + QualityBadge（tooltip 解释“Provider 未返回”），**永不显示 0**
- estimated：数值 + `≈` 前缀 + 徽标
- 每个图表 header 显示筛选范围与数据来源（exact/estimated/unknown 占比）

### 8.5 实时更新

插件通过事件总线 publish `usage.event.created` / `usage.aggregate.updated` → bridge `subscribe` → UI 局部刷新（节流 1s）。

### 8.6 验收

同一 bundle（同 checksum）分别挂载于 Desktop 与 VS Code，功能一致；UI 层零平台条件分支（仅 bridge 注入不同）。

## 9. Phase 6：发布与全链路验收（1.5 周）

- 签名/checksum：沿用 `scripts/check-signature.mjs` 与 `docs/signing.md` 流程；插件包在 CI 产出 `.tgz` + manifest 签名
- 更新回滚：安装新版 → 启动探活（5s 内 host entry 完成 init）→ 失败自动恢复旧版目录 + DB 备份
- 商城条目：registry snapshot 提交 + curated 申请
- 离线/权限测试：断网安装（snapshot）、拒绝 `storage.local` 后插件进入降级状态且 UI 明示
- 多平台矩阵：Windows/macOS/Linux desktop + VS Code，逐项跑最终方案 §17.4 清单

## 10. 测试策略汇总

| 层 | 工具 | 覆盖 |
|---|---|---|
| 协议 | `node:test` + zod | event/query schema 边界、禁字拒绝 |
| core 纯函数 | `node:test` | 映射、去重、流式合并、重试归并、价格、unknown 传播、缓存口径、保留清理 |
| Cordis 插件 | `node:test` + 内存 Cordis ctx mock | observer、pipeline、迁移、回滚、状态机 |
| UI | vitest + @testing-library/preact | 各页面渲染、unknown 视觉、bridge mock |
| 集成 | 现有 `tests/e2e` 模式 | desktop/vscode 挂载、真实对话采集 |
| 泄漏审计 | 专用测试 | 断言 DB/日志/导出物中无 prompt、key、原始 JSON |

CI 接入 `pnpm verify`（typecheck + lint + test + layer-audit），新增路径加入现有 glob。

## 11. 里程碑与工期

| 里程碑 | 内容 | 工期 | 交付判据 |
|---|---|---|---|
| M0 | 能力审计完成 | 1 周 | Capability Matrix 评审通过 |
| M1 | 插件可安装/启停 | 1.5 周 | 生命周期测试绿 |
| M2 | 真实事件入库 | 2 周 | 真实对话产出 usage.event.v1，无泄漏 |
| M3 | 统计正确性 | 2 周 | 重试/流式/去重专项测试绿 |
| M4 | 自定义 Provider 可用 | 1.5 周 | Fixture 矩阵全绿 + 映射测试器 |
| M5 | 双端 UI 上线 | 2.5 周 | 同 bundle 双端验收 |
| M6 | 商城发布 | 1.5 周 | 最终方案 §19 的 18 条验收全过 |

总计约 12 周（单人全职），2 人并行可压至 ~7 周（M2/M3 与 M5 UI 骨架并行）。

## 12. 风险与预案（增量于最终方案 §20）

| 风险 | 概率 | 预案 |
|---|---|---|
| Cordis 层无可订阅的 usage 事件 | 中 | Phase 0 首周即验证；不可用则在插件宿主层加事件发射（不动 Harness 业务码），最坏情况启用 SSE 尾部解析 |
| better-sqlite3 在 Electron/VS Code native 冲突 | 中 | 备选 sql.js（WASM），存储接口抽象在 `storage` 命名空间后，切换成本 2~3 天 |
| VS Code webview CSP 限制共享 bundle | 低 | bundle 不含内联脚本/eval，esbuild 单文件天然满足 |
| 聚合表口径争议（unknown 计数） | 低 | §6.1 已定：exact 累计 + unknown 计数分列，评审时与最终方案 §8 对齐 |
| 工期超支 | 中 | M5 的 Session/Turn 详情与缓存分析页可后移到 1.1，核心报表先交付 |

## 12.5 实施状态记录（2026-08-21 首轮纵向切片）

已按本方案完成自底向上的可运行纵向切片，全部代码进入仓库并纳入现有测试体系：

| 层 | 落地情况 | 测试 |
|---|---|---:|
| `packages/usage-protocol` | usage.event.v1 类型 + 字段级 quality + 运行时校验（拒绝敏感字段）+ Query API 类型 | 9 |
| `packages/usage-analytics-core` | 受限 JSONPath 映射引擎、缓存口径、流式合并/去重、版本化价格估算、daily 聚合 | 33 |
| `plugins/usage-analytics` | Cordis 入口 + 生命周期状态机（安装不采集/启用采集/禁用保留）、sql.js 存储、有界管线、标准/聚合/缓存查询、181 天保留 | 16 |
| 合计 | | 58 |

**关键落地决策**：
- 存储从 better-sqlite3 切换到 **sql.js（纯 WASM）**：本环境 Node 24.17 无 better-sqlite3 预编译二进制、原生编译受阻，遂执行方案 §12 既定备选。存储层以 `UsageStorage` 接口隔离，后续可无缝换回 better-sqlite3 适配器。
- 协议/核心包零第三方运行时依赖（手写类型守卫替代 zod），与仓库极简依赖哲学一致。
- 插件按 Cordis 服务形态实现，注册 `usageAnalytics` 服务供 desktop/vscode Host Bridge 调用。

**已覆盖的最终验收项**：3（安装后默认不采集）、5（Provider/Model/Session 关联）、6（流式不重复计数）、7（重试不重复计费）、8（缓存未知不当未命中）、10（字段级质量标识）、12（不存 API Key/Prompt/原始 usage）。

**第二轮推进（UI + Host Bridge + manifest）**：
- `packages/usage-analytics-ui`：纯函数渲染的共享 UI Bundle（overview/providers/cache/sessions/settings），unknown 显示为 em-dash 而非 0、费用卡片按能力开关、缓存命中率未知时不显示误导 miss 率；DOM 无关可单测 | +11
- `apps/desktop/src/plugins/usage-analytics-bridge.ts` + `usage-analytics-host.ts`：Electron contextBridge/IPC 桥 + 主进程 action 分发（可插拔服务解析接缝）
- `apps/vscode/src/plugins/usage-analytics-bridge.ts`：webview postMessage 桥
- `plugins/usage-analytics/src/manifest.ts` + `manifest.json`：manifest 结构/权限白名单校验 | +7
- 累计测试：**76 个全绿**，`tsc --noEmit` 与 ESLint 零错误

**第三轮推进（Phase 2 真实观测桥）**：
- 调研 DeepSeek Harness 源码，确认真实事件形状：`TokenUsage = { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens? }`、`session/event` Cordis 事件、`assistant/message`（含 `usage?`）/ `assistant/chunk`（usage chunk）、`turn/step` 关联。
- `plugins/usage-analytics/src/harness-collector.ts`：订阅 `session/event`，从 `assistant/message` 提取 usage，产出 `SafeObservedEvent`（session.id + turn/step → logical/turn ID），启用时启动、禁用时停止；对合成真实形状事件可单测。
- 插件入口新增 `config.harness` 接缝（getSession + subscribeSession），真实观测可无缝接入。
- normalizer 新增“直接规范化 usage（camelCase→协议字段）”路径，与声明式 Provider 映射路径并存。
- 新增 5 个测试；累计 **81 个测试全绿**，`tsc --noEmit` 与 ESLint 零错误。

**第四轮推进（跨进程桥 + UI 挂载 + 打包发布）**：
- `plugins/usage-analytics/src/engine-http.ts`：引擎侧注册 `/usage-analytics/api/*` 回环 HTTP 路由（复刻 plugin-marketplace 的 `webServer.register` 模式），插件 `config.engine.webServer` 接缝接入 | +5
- `apps/desktop/src/plugins/usage-analytics-host.ts`：主进程按需拉取对应端点的 HTTP 客户端 + `setUsageAnalyticsHttpClient`，host 就绪时以 `net.fetch(host.url)` 接入 main | +3
- `apps/desktop/src/plugins/usage-analytics-ui-page.ts`：可挂载的 UI 宿主页（CSP + preload 桥接线）
- `packages/usage-analytics-ui/src/mount-global.ts` + `scripts/build`：esbuild 产出 `ui/bundle.js`（8.6KB）
- `scripts/package-usage-plugin.mjs`：manifest 校验 + UI 构建 + tar 打包 + sha256 + 签名模板（已运行产出 `dist/plugins/*.tgz`）
- 累计测试：**90 个全绿**，`tsc --noEmit` 与 ESLint 零错误。

**唯一剩余真机验收**：在运行中的 Electron/VS Code/Cordis 宿主内加载插件、真实跑一轮对话验证端到端采集，以及用团队私钥对已生成产物签名后发布到商城。这些依赖运行环境与签名密钥，静态代码已全部就绪且全部测试通过。

## 13. 后续版本（1.1+，不在本期）

- Web 端 IndexedDB 存储适配器与正式验收
- Loopback 代理观测（可选兼容模式）
- 联网汇率/价格表更新（显式 opt-in）
- 导出格式扩展（Excel/PDF 报表）

## 12.6 第五轮：全面升级优化（2026-08-21，一次全部完成）

按用户要求对本插件做一轮全面升级与深度修复，重点面向**桌面客户端 + 共享 Web UI**，后续插件不再支持 vscode。本轮不新增 vscode 端测试，集中把桌面端与共享 UI 打磨到一致可用。

**深度修复**：
- `storage-query` 测试用例修正：聚合 token 需以 normalizer 产物（字段级 `exact`）为准，测试 helper 由 `defaultQuality()`（全 unknown）改为 `exactQuality()`；延迟分位数由 `floor(q·n)` 改为标准线性秩 `floor(q·(n-1))`（p50 落中位、p100 落末位），测试 p95 期望随实现修正为自洽值。
- **UI/宿主契约错位修复（关键）**：`app.ts` 原读取 `res.data.overview` 聚合结构，而 desktop 的 `dispatchUsageAnalyticsAction` 按 view 返回**单数数据块**，导致实际概览页渲染为空。统一为 **view 驱动单数返回**：`QueryRequest` 新增可选 `view` 字段，UI 每路由显式传 `{view}` 并直接消费 `res.data`；desktop 宿主页 bridge 保持不变。

**升级功能**：
- 存储查询扩展：`getDailyTrend` / `getModelBreakdown` / `getSessionUsage` / `getTurnUsage` / `exportUsage`(json/csv) / 延迟分位数（overview）
- 内置 Provider 模板：openai-compatible / deepseek / anthropic-compatible / gemini-compatible + 版本化默认价表 `DEFAULT_PRICE_TABLE`
- 费用接线 `applyCost`：默认关闭，opt-in 后本地估算并标 `estimated`
- `engine-http.ts` 新路由：`/trend` `/models` `/session`(session/turn) `/export`
- `usage-analytics-host.ts` 新视图 dispatch：trend/models/session/export/settings(→`/status`)，HTTP 与 in-process 双分支
- 共享 UI 新增 **Trend（每日趋势）与 Models（模型）** 视图，路由扩为 7 项

**测试与产物**：
- 新增：engine-http 新路由 +4、lifecycle 费用接线 +2、builtin 内置模板 +6、desktop host 新视图 +2、UI trend/models 渲染 +3
- 累计测试：**90 → 113 个全绿**；`tsc --noEmit` 与 ESLint 零错误
- UI bundle 重建：8.6KB → **10.2KB**；重新打包 `dist/plugins/com.my-dsh.usage-analytics-0.1.0.tgz`（含新视图）

**用户决策（影响后续插件）**：后续其他插件**以桌面客户端为主、支持共享 Web UI 展示即可，不再支持 vscode**。本插件保留已生成的 vscode host 不改不删，但不再为其补测。

## 12.7 第六轮：桌面底部实时状态条（2026-08-21）

按参考图（AI 客户端底部使用量状态栏）在桌面主窗口底部实现**实时用量状态条**，随实际对话动态刷新。用户确认：**主窗口底部常驻** + **费用随能力开关**。

**实现链路**（不改上游 Harness）：
- `storage.getSessionStats(sessionId)`：会话维度实时汇总——累计 input/output/cache tokens、缓存命中率（命中 token / 输入 token，仅 known 数据）、turn 数、最后一次请求明细（model/tokens/cache/cost）
- `index.querySessionStats()`：追踪最近活跃会话（ingest 时更新 `lastSessionId`），返回附 `cost_enabled`（随费用能力开关）
- `engine-http /usage-analytics/api/session-stats`：新增回环路由
- desktop `view=session-stats` dispatch（HTTP 与 in-process 双分支）
- `apps/desktop/src/preload.ts`：注入底部状态条组件（复用现有 MutationObserver 注入模式），每 3s 轮询 `usage-analytics:action` 动态渲染；未知值显示 `—`，费用列随 `cost_enabled` 显隐，余额因不存 API Key/不上传显示 `—`

**验证**：新增 storage/engine-http/lifecycle/desktop-host 6 个测试；累计 **113 → 119 全绿**，`tsc`/ESLint/prettier 通过；`preload.cjs` 编译验证含状态条注入；重新打包 `dist/plugins/*.tgz`（含 session-stats 路由）。

**边界说明**：上下文=会话累计 tokens 估算；压缩阈值/余额因插件不采集显示 `—`。

## 12.8 第七轮：链路深度审查与优化（2026-08-21）

对完整链路（采集→规范化→存储→查询→HTTP→desktop→状态条）做系统性审查，修复以下问题：

**正确性/安全（P0）**：
- **dbPath 磁盘持久化接线**：此前 `dbPath` 配置存在但始终用内存库（重启即丢）。现实现：启动时若文件存在则加载字节；每次 flush/保留清理/dispose 后以「临时文件+rename」原子写回；默认无 dbPath 仍纯内存。
- **retention 同步清理 `usage_daily`**：此前只删 `usage_events`，趋势表残留已过期的聚合数据；现按 cutoff 日期同步删除 daily 行（全清时也清空 daily）。
- **状态条 XSS 修复**：`model_id`/标签直接拼 innerHTML 未转义；新增 `esc()` 转义，`usageStat` 对标签统一转义。
- **状态条货币符号**：此前硬编码 `¥`，与默认价表 USD 不符；现按 `cost_currency` 映射符号（USD→$、CNY→¥…）。

**健壮性（P1）**：
- **dispatch `status` 分支补 resolver fallback**：此前 HTTP 未配置时返回 null；现与 query 路径一致，HTTP 优先、in-process resolver 兜底。
- **状态条空闲降频**：固定 3s setInterval 改为 setTimeout 自调度链；无活跃会话时退避到 10s，减少空轮询 IPC。
- **session-stats 补 `cost_currency`**：供状态条正确显示币种。

**口径文档化**：缓存命中率在 `getCacheAnalysis`（read/(read+write+create)）与 `getSessionStats`（cache_read/input，仅 known 数据）口径不同，属两种视图的合理定义，已在 README 标注。

**验证**：新增 3 个测试（retention daily 清理、dbPath 重启保留、status fallback）；累计 **119 → 122 全绿**；usage 相关文件 `tsc`（有范围校验）零错误；ESLint/prettier/preload 编译全部通过；重新打包。

**环境说明**：仓库级 `tsc` 现报告 `plugins/plugin-marketplace/src/index.ts` 的 `writeToggle` 等错误——该目录为**未跟踪**（`??`）状态、属仓库/环境既有内容，与本次改动无关，按「不触碰无关改动」原则未处理；usage-analytics 全部文件类型检查零错误。

## 12.9 第八轮：链路深挖（协议/core/normalizer 边界）（2026-08-21）

继续深挖采集→规范化→合并→聚合链路的边界与语义问题：

**修复**：
- **`getOverview.error_rate` 语义 bug**：此前填的是 `success/request_count`（成功率）却命名为 error_rate，且与 `getProviderBreakdown`（errors/cnt）不一致，UI「Error rate」显示误导；改为 `error_count/request_count`。
- **`finalizeStream` 注释与实现矛盾**：注释称「prefer final usage」，实现却是 first-wins（早期 chunk 覆盖最终权威 token）；改为**final 非 null 字段 last-wins 覆盖**，与 mergeChunk（流式增量 first-wins）明确分工。
- **`StreamMerger.seen` 无界增长**：dedup 集合只增不减，长跑内存泄漏；加 `MAX_SEEN` 上限，超限重置（storage 层 UNIQUE 约束仍兜底防重复）。
- **`observed_at` NaN 防御**：无效时间 `new Date().getTime()` 得 NaN 会写坏库；storage 层回落当前时间。
- **normalizer event_id 跨 source 冲突**：不同来源（provider_response/log_parser）同 logical+attempt 生成相同 event_id 被 UNIQUE 拒绝；event_id 加 `source` 前缀消歧。

**验证**：新增 3 个测试（overview error_rate、final 覆盖 last-wins、dedup 内存上限）；累计 **122 → 125 全绿**；有范围 `tsc`/ESLint/prettier 通过；重新打包。
