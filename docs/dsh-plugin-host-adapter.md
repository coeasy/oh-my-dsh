# 插件宿主接线契约（model-config / degeneration-guard）

> 版本：0.1.0  
> 关联方案：`docs/dsh-model-config-plugin-plan.md`  
> 日期：2026-08-21

本文档是桌面/VS Code 宿主侧把两个新插件真正接入引擎所需的**最小接线契约**。插件侧代码已就绪并通过测试；本文档描述宿主需要提供的 seam 实现与对应的引擎能力，以及当前仍缺失、需客户端侧落地的 Host API 缺口。

## 1. 总体原则

- 两个插件都是**独立 Cordis 插件**，宿主只需在加载时注入 `host` seam 对象。
- 所有 seam 均可缺省；缺省时插件优雅降级（只保留自身能力），绝不崩溃。
- 不修改上游 DeepSeek Harness 业务代码；seam 只是把引擎**已有内核行为**（ModelSelectionRef 快照、AbortSignal、子代理 agentModel、settings 命名空间）暴露给插件。

## 2. model-config 接线

### 2.1 服务入口

加载 `plugins/model-config/src/index.ts`，得到 `modelConfig` 服务（`apply(ctx, { storePath | backend, host })`）。

### 2.2 seam → 引擎映射

| 插件 seam | 宿主实现要点 | 引擎能力 | 当前状态 |
|---|---|---|---|
| `host.defaultModelStore.read/write` | 读写 `AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE` | `@deepseek-ai/dsh-agent-default-model` | 引擎已有，宿主接线即可 |
| `host.modelSwitch.apply(sessionId, sel)` | 把 `{provider, model, reasoningEffort}` 写到该会话的 `ModelSelectionRef`，保证步骤边界快照语义 | `installModelSelection`（`@deepseek-ai/dsh-agent/model-selection`） | 引擎已有，宿主需暴露窄接口 |
| `host.planMode.isActive/subscribe` | 订阅 plan mode 激活/退出 | plan-mode 包；**激活事件当前未在插件可观测事件面暴露** | **P0 缺口，需客户端补事件** |
| `host.subagent.resolve(role)` | 在子代理创建、`agentModel` 为空时调用插件 `resolveChild(role)` 注入；显式声明不覆盖 | 子代理描述符 `agentModel` + `ContinuableSetupContribution` 组装点 | 引擎已有，宿主需在创建钩子调用 |
| `getCatalog/setCatalog` | 宿主从 provider 路由 + adapter `efforts` 构造 `ModelCatalog` 注入，UI 据此渲染档位 | llm adapter `LlmReasoningEffortInfo` | 引擎已有，宿主组装即可 |

### 2.3 建议调用时序

1. 插件加载 → `apply(ctx, { backend, host })`；宿主把 `agentDefaultModel` settings seam 注入。
2. 宿主组装 `ModelCatalog` 并调用 `svc.setCatalog(...)`。
3. plan mode 激活 → 宿主收到事件 → 调 `svc.getResolved()` 取 planning binding → `host.modelSwitch.apply(sessionId, binding)`。
4. 子代理创建 → 宿主调 `svc.resolveChild(role, explicit)` 决定是否注入。

## 3. degeneration-guard 接线

### 3.1 服务入口

加载 `plugins/degeneration-guard/src/index.ts`，得到 `degenerationGuard` 服务（`apply(ctx, { config, host })`）。

### 3.2 seam → 引擎映射

| 插件 seam | 宿主实现要点 | 引擎能力 | 当前状态 |
|---|---|---|---|
| `host.interrupt.canAbort/abort(reason)` | 对当前步骤的请求触发 AbortSignal；保证只影响当前请求、已生成内容保留 | Agent `AbortSignal`（`runMaintenance`/发送侧取消） | 引擎已有信号，宿主需把流级取消暴露给插件 | 
| `host.reminder.inject(text)` | 把反循环提示作为 `{kind:'plugin'}` 上下文注入下一步请求（对齐引擎 repeat-tool-reminder 的注入语义） | `additionalContexts` / user/message 注入 | 引擎已有，宿主接线即可 |
| 流式 delta 喂给 `svc.feed('thinking'|'text', delta)` | 宿主把请求流 delta（含 reasoning segment）转发给插件；步骤边界调 `resetSegment`/`resetAll` | 引擎流式事件 | **P0 缺口：当前无插件可订阅的流式 delta 事件面** |

### 3.3 建议调用时序

1. 请求开始 → 宿主置 `canAbort=true`；开始把 delta 喂给 `feed`。
2. `feed` 返回 `retry` → 宿主调 `reminder.inject(...)` + `interrupt.abort(...)`（插件已代发，宿主只需实现 seam）。
3. `feed`/`feedToolCall` 返回 `pause` → 宿主暂停步骤并弹出用户决策（继续 / 换模型重试 / 终止），用户选择后调 `svc.resume()`。
4. 每个 agent 步骤结束 → `noteStep(sessionId)`（轮次计数）+ `resetAll()`。**注意**：`resetAll()` 是步骤边界重置，不清除轮次计数；轮次上限靠 `noteStep` 跨步骤累计。
5. 思考段结束/工具调用 → `resetSegment('thinking')`。
6. 会话结束 → `resetSession(sessionId)` 释放该会话的轮次计数（防止长期运行内存增长）；`resetSession()`（无参）彻底清空。
7. 每次变更后 `feed` 返回 `retry`/`pause` 时，宿主应在状态栏/UI 展示 `getStatus()` 的 `active` 与 `stats`，暂停时提供「继续/换模型重试/终止」三选，用户选择后调 `resume()`。

## 4. 待客户端落地的 Host API 缺口（P0）

按方案 §6.3 / §13.1，以下接口是引擎能力已存在但尚未以插件可观测形式暴露的部分：

| # | 缺口 | 用途 | 建议暴露形式 |
|---|---|---|---|
| 1 | plan mode 激活/退出事件 | 规划模型热切换 | 会话事件面新增 `plan/activated`、`plan/deactivated` |
| 2 | 流式 delta 订阅（含 reasoning segment 边界） | guard 平面 B | 会话事件面新增 `request/delta`（kind=thinking/text，携带 sessionId） |
| 3 | Agent 中断出口 | guard 强制停止/自动重试 | 宿主把 Agent 取消信号封装为可注入 seam |
| 4 | 子代理创建前钩子 | 子代理默认注入 | 复用 `ContinuableSetupContribution`，宿主在子代理上下文组装点调用插件 |
| 5 | provider/model 路由校验 + efforts 列表 | 保存前校验 + UI 档位 | 宿主组装 `ModelCatalog` 注入 |

## 5. 桌面 UI 宿主页

两个插件的设置/状态页均已提供可挂载 HTML：

- `apps/desktop/src/plugins/model-config-ui-page.ts` → `modelConfigPageHtml(bundlePath, nonce)`
- `apps/desktop/src/plugins/degeneration-guard-ui-page.ts` → `guardPageHtml(bundlePath, nonce)`

宿主需：在 preload 暴露 `window.dshDesktop.modelConfig` / `window.dshDesktop.degenerationGuard`（IPC → 主进程 → 引擎回环或服务直调），并按 `usage-analytics-ui-page.ts` 的模式注册窗口/路由。接线完成前，页面会渲染「宿主尚未接线」状态而非报错。

## 6. 验收清单

接线完成后按以下项验收（与方案 §10 一致）：

- [ ] 设置 default 模型 → 新会话使用该模型（与 `/model` 查询一致）
- [ ] 设置 planning 独立模型 → plan mode 激活后下一步请求走规划模型，退出还原
- [ ] 设置 subagent 模型与 effort → task 派发的子代理请求头为该模型与档位
- [ ] 思考流循环 → guard 首次命中自动重试一次并注入反循环提示，再次命中暂停
- [ ] 工具连续相同调用 12 次 → guard 暂停
- [ ] 会话超过 30 轮 → guard 提醒不强停
- [ ] 禁用 guard（mode=off）→ 全部旁路；卸载任一插件 → 引擎默认行为，无残留
