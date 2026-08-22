# @dsh/plugin-usage-analytics

DeepSeek Harness **Usage Analytics** 独立插件：Token 用量、缓存请求、多 Provider 请求分析。

本插件以 **独立 Cordis 插件** 形态运行，**不修改上游 DeepSeek Harness**；可独立安装 / 启用 / 禁用 / 更新 / 卸载。默认**本地运行、不上传**，且**不保存 Prompt / Response / API Key / 原始 usage JSON**。缺失字段一律显示 `unknown`（UI 渲染为 `—`）而非 0。费用估算默认关闭、opt-in 开启。共享 UI（Web 视图）三端复用同一套界面。

> 维护约定（2026-08）：本插件以及后续其他插件**以桌面客户端为主、共享 Web UI 展示即可，不再支持 vscode**。

---

## 1. 架构分层

```
packages/usage-protocol/        usage.event.v1 协议：事件类型 + 字段级 quality + Query API
packages/usage-analytics-core/  纯逻辑：受限 JSONPath 映射、缓存口径、流式合并、价格估算、daily 聚合
packages/usage-analytics-ui/    共享 Web UI Bundle：纯函数渲染 + host bridge 契约（平台无关）
plugins/usage-analytics/        Cordis 插件：生命周期、sql.js 存储、有界管线、观测器、引擎 HTTP 桥
apps/desktop/src/plugins/       desktop 端桥：bridge 适配器、主进程 dispatch、UI 宿主页
scripts/package-usage-plugin.mjs 打包发布脚本（manifest 校验 + UI 构建 + tar + sha256 + 签名模板）
```

数据流（desktop 生产链路）：

```
Harness session/event
   └─ harness-collector.ts  订阅 assistant/message 提取 TokenUsage
        └─ normalizer.ts    受限 JSONPath / 直接规范化 → usage.event.v1
             └─ pipeline.ts 有界去重管线
                  └─ storage.ts (sql.js)  ← 保留策略 181 天
                       └─ engine-http.ts 注册 /usage-analytics/api/* 回环路由
                            └─ desktop host.ts  net.fetch(host.url + 路由) → UI bundle
```

---

## 2. 目录

| 路径                                | 说明                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`                      | Cordis 入口：生命周期状态机、`usageAnalytics` 服务、费用接线、保留调度 |
| `src/harness-collector.ts`          | 订阅 `session/event`，从 `assistant/message` 提取 usage                |
| `src/normalizer.ts`                 | 规范化（字段级 quality、拒绝敏感字段）                                 |
| `src/pipeline.ts`                   | 有界去重写入管线                                                       |
| `src/storage.ts`                    | sql.js 存储（`UsageStorage` 接口隔离，可换回 better-sqlite3）          |
| `src/engine-http.ts`                | 引擎侧 `webServer.register` 回环 HTTP 路由                             |
| `src/builtin.ts`                    | 内置 Provider 模板 + 默认价表                                          |
| `src/manifest.ts` / `manifest.json` | manifest 结构与权限白名单校验                                          |
| `tests/`                            | 插件单元测试                                                           |

---

## 3. 构建 / 测试 / 打包

仓库根目录一键命令：

| 命令                         | 作用                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm test:usage-analytics`  | 跑 usage 相关全部测试（protocol/core/ui/plugin/desktop-host）                        |
| `pnpm build:usage-analytics` | 构建共享 UI Bundle → `packages/usage-analytics-ui/ui/bundle.js`                      |
| `pnpm pack:usage-analytics`  | manifest 校验 + 总是重建 UI Bundle + 复制进插件 `ui/` + tar 打包 + sha256 + 签名模板 |

在插件目录内也可直接：

```bash
cd plugins/usage-analytics
pnpm test       # 仅插件自身测试
pnpm build      # 构建 UI Bundle
pnpm package    # 打包
```

打包产物：

```
dist/plugins/com.my-dsh.usage-analytics-0.1.0.tgz       可安装包（自包含 UI bundle）
dist/plugins/com.my-dsh.usage-analytics-0.1.0.tgz.sha256 校验和
dist/plugins/com.my-dsh.usage-analytics-0.1.0.signed.json 签名模板（signature 需发布人用私钥填写，见 docs/signing.md）
```

> 构建可复现性：`pack` 总是从源码重建 bundle，不依赖上次产物；打包时把 bundle 复制进插件 `ui/`，保证分发包自包含、desktop 宿主页可直接加载。

质量门槛（提交前执行）：

```bash
pnpm test:usage-analytics   # 113 个用例全绿
pnpm typecheck              # tsc --noEmit 零错误
pnpm lint                   # ESLint 零错误
pnpm format                 # prettier 统一格式
```

---

## 4. 配置（插件 apply 入参）

| 字段               | 默认         | 说明                                                                                                                |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `dbPath`           | 内存         | 持久化 DB 路径；为空仅内存                                                                                          |
| `retentionDays`    | 181          | 原始事件保留天数                                                                                                    |
| `providerMapping`  | 内置默认     | 显式 `ProviderMapping`、内置 id（`openai-compatible`/`deepseek`/`anthropic-compatible`/`gemini-compatible`）或 null |
| `costEnabled`      | false        | **费用估算默认关闭**；开启后本地估算并标 `estimated`                                                                |
| `priceTable`       | 内置默认价表 | 版本化价表（USD）                                                                                                   |
| `harness`          | —            | 真实观测接缝（`getSession` + `subscribeSession`）                                                                   |
| `engine.webServer` | —            | 引擎侧回环 HTTP 路由注册接缝                                                                                        |

### 生命周期（安装 ≠ 采集）

- 安装/加载：默认 **不采集**；
- `setEnabled(true)`：开始订阅并采集，发送 `usage.plugin.status_changed`；
- `setEnabled(false)`：停止采集但**保留已存数据**；
- `dispose`：flush + 停表 + 关库。

---

## 5. 权限与安全

manifest 权限白名单（仅允许）：

```
usage.observe   storage.local   ui.mount   events.subscribe
```

显式禁止：`network.any`、`filesystem.any`、`native_code`、`process.spawn`、`credential.read`。

数据安全约束（协议层强制）：

- **不保存** Prompt / Response / API Key / 原始 usage JSON（结构上不存在这些字段）；
- token/成本列 `NULL` = unknown，**不强制转 0**；
- 引擎 HTTP API 仅绑定 `127.0.0.1` 回环；
- 费用为本地估算、默认关闭、标 `estimated`。

---

## 6. 桌面底部状态条（实时用量条）

插件安装启用后，桌面主窗口底部会注入一条**实时使用状态条**（preload 注入，复用现有 MutationObserver 注入模式），随实际对话**动态刷新**（默认每 3 秒轮询引擎回环 API，无需重启客户端）。

显示指标：

| 指标            | 说明                                                        | 数据来源                      |
| --------------- | ----------------------------------------------------------- | ----------------------------- |
| 模型            | 当前会话最后请求的模型                                      | `model_id`                    |
| 本次tokens      | 最近一次请求 input+output                                   | `last_input/output_tokens`    |
| 本次命中        | 最近一次请求缓存命中 token                                  | `last_cache_read_tokens`      |
| 会话tokens      | 会话累计 input+output                                       | `SUM(input/output)`           |
| 平均命中        | 缓存命中 token / 输入 token（仅 known 数据）                | `cache_hit_rate`              |
| 本次/会话费用   | 仅当 `costEnabled` 开启显示估算费用，否则显示「费用未开启」 | `cost_value` + `cost_enabled` |
| 会话轮次        | 会话内不同 turn 数                                          | `COUNT(DISTINCT turn_id)`     |
| 上下文          | 会话累计 tokens 估算                                        | 同会话tokens                  |
| 压缩阈值 / 余额 | 插件不采集，显示 `—`                                        | —                             |

约束：未知值一律显示 `—`（非 0）；费用随 `costEnabled` 能力开关；余额因插件不上传、不保存 API Key 而无法获取，显示 `—`。

实现链路：`storage.getSessionStats` → `index.querySessionStats`（附 `cost_enabled`）→ `engine-http /usage-analytics/api/session-stats` → desktop `view=session-stats` → preload 注入组件轮询渲染。

## 7. 共享 UI

桌面端通过 `apps/desktop/src/plugins/usage-analytics-ui-page.ts` 加载 `packages/usage-analytics-ui/ui/bundle.js`，经 preload bridge → IPC → 主进程 `dispatchUsageAnalyticsAction` 查询引擎回环路由。

视图（view 驱动、按需拉取单数数据块）：

```
Overview  Daily trend  Providers  Models  Cache  Events  Settings
```

UI 契约要点：

- `QueryRequest` 携带可选 `view` 字段；每路由显式传 `{view}`，host 返回**单数数据块**（非聚合对象）；
- unknown 渲染为 `—`（em-dash）而非 0；缓存命中率未知时不显示误导的 miss 率；
- 费用卡片仅在 host 能力 `costEstimation=true` 时出现。

---

## 8. 实施状态

- 五轮推进全部落地，`113` 个测试全绿，`tsc`/ESLint/prettier 通过。
- 完整规划与实施记录见 `docs/dsh-usage-analytics-final-plan.md`、`docs/dsh-usage-analytics-dev-plan.md`（§12.5–12.6）。

**真机验收（剩余）**：在运行中的 Electron/Cordis 宿主内加载插件、跑一轮真实对话验证端到端采集；用团队私钥签名后发布商城。静态代码已全部就绪。
