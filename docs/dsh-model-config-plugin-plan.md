# my-dsh 模型使用配置插件方案

> 文档版本：0.2.1  
> 项目：my-dsh / DeepSeek Harness 客户端生态  
> 日期：2026-08-21  
> 状态：评审中（v0.2 增补退化检测与评估阶段；v0.2.1 落定 Q1–Q4 产品决策，见 §13.2）

## 1. 方案结论

本插件以「**分阶段模型路由 + 思考档位配置**」为核心，提供默认模型、规划模型、子代理模型等按阶段独立配置的能力，并允许为每个阶段单独设置思考档位（reasoning effort）。

插件 ID 建议：

    com.my-dsh.model-config

产品形态与 `usage-analytics` 一致：独立安装的 Cordis 插件，通过插件商城或本地插件包安装，不修改上游 DeepSeek Harness。客户端侧需要复用（或补齐）Plugin Host API 中的三类能力：**设置读写、Agent 生命周期观测、模型选择注入**。

关键结论：

1. 「默认模型 + 思考档位」引擎已原生支持（`agentDefaultModel` 设置命名空间），插件直接读写即可。
2. 「规划阶段使用独立模型」引擎当前没有独立字段，但 `ModelSelectionRef` 机制支持每步切换模型，插件可在 plan mode 激活/退出时切换选择，作为桥接方案。
3. 「子代理模型」引擎的子代理描述符已支持 `agentModel`，插件补齐默认值注入和按角色覆盖。
4. 「思考轮次」在引擎侧的现实是 **adapter 拥有的 reasoning effort 档位**（如 low/medium/high/auto），不存在数值型思考轮次；插件以档位表达思考深度，数值型轮次上限列为引擎侧扩展调研项（vLLM 已出现 `thinking_token_budget` 一类请求级参数，schema 预留字段保持兼容）。
5. 「检测模型重复输出并自动停止」**可行**，业内有成熟分层先例（Claude Code 卡循环自动停止、vLLM `RepetitionDetectionParams`）。引擎已有 advisory 级工具重复检测（`repeat-tool-reminder`），缺文本/思考流级检测与强制停止出口；本方案新增 Degeneration Guard 能力（§12），建议作为独立 guard 插件实现。
6. 借鉴 Claude Code `/goal` 的评估模型（默认 Haiku）设计，新增 `evaluation` 轻量评估阶段，用于停止条件判定等低成本判断（§4）。

## 2. 参考设计与需求对齐

参考 UI（评审截图）包含以下配置项，本方案逐项对齐：

| 参考配置项 | 本方案 | 引擎现状 |
|---|---|---|
| 默认模型（新会话用） | 阶段 `default` 的模型选择 | 已支持，settings 命名空间直写 |
| 独立规划模型（单模型/独立） | 阶段 `planning`，可回退「跟随默认」 | 无独立字段，需桥接（见 §6.2） |
| 子代理模型 | 阶段 `subagent`，含按角色覆盖 | 子代理支持 `agentModel`，缺默认注入入口 |
| 子代理 effort | 阶段 `subagent` 的思考档位 | `reasoningEffort` 已支持 |
| 子代理嵌套深度 | 相邻配置项（`adjacent`，首期只读展示或后续接入） | 引擎有 depth 概念，配置入口待调研 |
| 子代理并发数 / 并行写入数 | 相邻配置项（首期不做） | 引擎有并发控制，与本插件核心解耦 |
| 思考语言 / 自动压缩阈值 | 不纳入本插件 | 与模型路由无关 |

用户核心诉求落在两处，其余参考项只作为 UI 信息架构的参照：

- **思考轮次配置**：每个阶段可独立设置思考档位（详见 §5.2 的术语澄清）。
- **不同阶段使用不同模型**：default / planning / subagent 三个首期阶段。

## 3. 已确定的约束

### 3.1 必须满足

- 不修改上游 DeepSeek Harness 源码
- 插件支持商城安装和本地插件包安装，支持启用、禁用、更新、卸载
- 配置变更对**新会话**立即生效；**已有会话**继续使用各自保存的模型选择，除非用户显式应用
- 每个阶段的模型选择必须经过 provider/model 路由校验，不存在的模型不可保存
- 思考档位选项来自 adapter 公布的 `efforts` 列表，不硬编码档位名
- 模型切换只发生在步骤边界（与引擎 `ModelSelectionRef` 的快照语义一致），不拆分同一步骤内的请求
- Windows、macOS、Linux、Web、VS Code 使用同一套 UI 和配置逻辑
- 禁用插件后所有阶段回退引擎默认行为，不残留半生效状态

### 3.2 首期不做

- 不做数值型「思考轮次/token 预算」的强制注入（引擎无此参数，见 §5.2）
- 不做自动按任务复杂度选模型的「智能路由」（可作二期方向）
- 不接管子代理并发数、并行写入数、嵌套深度（归属其他配置面）
- 不做跨设备配置同步（配置存本地，与引擎设置文件同生命周期）
- 不代理或存储任何 API Key（凭据管理归引擎 credentials 包）

## 4. 核心概念模型

```
Stage（阶段）
  ├─ default     主会话默认模型（新会话入口）
  ├─ planning    规划阶段（plan mode 激活期间）
  ├─ subagent    子代理阶段（task / reviewer / worker 等子代理）
  └─ evaluation  评估阶段（停止条件/goal 判定等轻量判断，默认回退 default）

每个 Stage 绑定一个 StageModelBinding：
  { provider, model, reasoningEffort?, thinkingBudget?(预留), enabled }

Profile（场景预设）
  一组 StageModelBinding 的命名集合，如「深度规划」「快速日常」「省流量」
```

### 4.1 配置解析优先级

从高到低：

1. 会话内用户显式切换（临时，不落盘）
2. 会话保存的模型选择（引擎已有语义，插件不覆盖）
3. 当前启用的 Profile 中该阶段的绑定
4. 阶段独立设置（未启用 Profile 时）
5. 引擎 `agentDefaultModel` 默认值
6. Provider 自身默认行为

`evaluation` 阶段缺省回退 `default`，不做特殊处理；仅当用户显式配置（如指向 flash-lite 类轻量模型）时生效。先例：Claude Code `/goal` 的评估模型默认用 Haiku，而非主对话模型。

规则：

- 任一阶段选择「跟随默认」（binding 缺省）时，向上回退到 `default` 阶段。
- `reasoningEffort` 缺省 = 不传，由 provider 决定默认思考行为；**不把缺省伪造成 auto**。
- Profile 切换只影响后续新创建的 Agent / 子代理，不热改运行中的会话。

## 5. 「思考轮次」的落地定义

### 5.1 引擎事实

- 模型的可选思考档位由 adapter 公布（`LlmReasoningEffortInfo` 列表，含展示名与顺序）。
- `ModelSelection.reasoningEffort` 是可选字段：缺省时保持 provider 默认。
- 档位切换与模型切换共享同一步骤边界快照机制。

### 5.2 设计决策

**首期用「思考档位」表达「思考轮次」**：UI 上每个阶段展示该模型 adapter 公布的档位列表（如 minimal/low/medium/high），外加「默认（由服务方决定）」一项。不虚构档位，不把数值滑杆映射到不存在的引擎参数。

**数值型思考轮次列为引擎侧调研项**：如果上游未来暴露 per-request 思考预算（thinking budget / max reasoning tokens），插件在 `StageModelBinding` 中新增可选字段即可向后兼容，schema 预留 `thinkingBudget?: number` 字段（首期忽略且不展示）。

### 5.3 子代理思考档位

子代理 effort 作用于 task 工具与 `runAs=subagent` 的技能派发。插件允许：

- 为 `subagent` 阶段设置默认 effort；
- 为 reviewer / worker 等角色设置覆盖值（角色列表来自子代理描述符的可枚举角色）；
- 未设置时缺省为不传（provider 默认），与参考 UI 的 `auto（模型服务默认）` 语义一致。

## 6. 引擎能力映射与桥接

### 6.1 直接可用（读写设置命名空间）

| 能力 | 引擎接口 |
|---|---|
| 默认模型 + effort | `agentDefaultModel` 服务、`AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE` |
| 档位列表 | adapter 公布的 `efforts`（按 provider/model 路由查询） |
| 设置变更通知 | `settings/updated`、`settings/document-updated` 事件 |

插件对默认阶段的写入直接落到该命名空间，保证桌面端、VS Code、Web 与引擎原生 `/model` 命令看到同一个事实来源。

### 6.2 需要桥接（插件侧实现）

**规划模型切换**：引擎的 plan-mode 没有独立模型字段。桥接方案：

1. 插件订阅会话的 plan mode 激活/退出状态（经 Plugin Host API 暴露的会话观测事件；若上游无事件，则只做「新会话在 plan mode 下启动时应用规划模型」的保守版本）。
2. 激活时把 `ModelSelectionRef.current` 切到规划绑定；退出时还原为会话原选择。
3. 切换发生在步骤边界，由引擎快照机制保证同一步骤内请求不被拆分。

**子代理模型默认注入**：子代理创建时描述符支持 `agentModel`，但缺省值没有全局配置入口。桥接方案：

1. 插件经 Plugin Host API 注册子代理创建观测（对应引擎 `ContinuableSetupContribution` 一类的子代理上下文组装点）。
2. 子代理解析 `agentModel` 时若为空，按「角色覆盖 → subagent 阶段默认 → default 阶段」注入。
3. 显式声明了模型的子代理不受影响。

### 6.3 缺口清单（需向 Plugin Host API 提出的能力申请）

| 能力 | 用途 | 优先级 |
|---|---|---|
| plan mode 激活/退出事件 | 规划模型热切换 | P0 |
| 子代理创建前钩子（可改写 agentModel/effort） | 子代理默认注入 | P0 |
| provider/model 路由校验 API | 保存前校验 + 档位列表 | P0 |
| 会话模型切换 API（写 `ModelSelectionRef`） | 规划模型切换 | P0 |
| 压缩（compaction）阶段模型选择 | 让压缩走便宜模型 | P1 调研 |
| 流式 delta 订阅（含 reasoning segment 边界） | guard 插件平面 B 检测 | P0 |
| Agent 中断出口（AbortSignal） | guard 插件强制停止/自动重试 | P0 |
| agent/pre-step 步骤边界事件 | guard 插件平面 A 强制暂停 | P0 |

以上能力均为「暴露已有内核行为」的只读/窄写接口，不要求上游改业务逻辑，符合本仓库不改内核的约束。

## 7. 插件包结构

```
model-config-plugin/
├── manifest.json
├── host/
│   └── entry.ts            # Cordis 入口，注册 modelConfig 服务
├── core/
│   ├── schema.ts           # StageModelBinding / Profile 的 schema 与校验
│   ├── resolver.ts         # 优先级链解析（§4.1）
│   ├── planner-bridge.ts   # plan mode 切换桥（§6.2）
│   ├── subagent-bridge.ts  # 子代理默认注入桥（§6.2）
│   └── migration.ts        # 配置版本迁移
├── storage/
│   └── settings-store.ts   # 落盘：引擎 settings 命名空间 + 插件本地节
├── ui/
│   └── bundle.js           # 设置页（esbuild IIFE，同 usage-analytics 管线）
└── tests/
    ├── schema.test.ts
    ├── resolver.test.ts
    ├── planner-bridge.test.ts
    └── subagent-bridge.test.ts
```

manifest 关键字段：

```json
{
  "id": "com.my-dsh.model-config",
  "api_version": "plugin.host.v1",
  "targets": ["desktop", "vscode"],
  "permissions": [
    "settings.read", "settings.write",
    "session.observe", "model.switch",
    "subagent.configure", "ui.mount", "events.subscribe"
  ]
}
```

新增权限 `model.switch` 与 `subagent.configure` 需要客户端插件宿主在权限边界里定义明确语义（只允许切换步骤边界选择、只允许填充空缺省值）。

### 7.1 配置存储

```
settings 文件（引擎命名空间）
  agentDefaultModel        ← default 阶段（引擎原生字段）

插件自有配置节（com.my-dsh.model-config）
  schemaVersion: 1
  stages:
    default:    { follow: null }                  # 由 agentDefaultModel 承载
    planning:   { follow: "default" }             # 默认跟随
    subagent:   { follow: "default",
                  roles: { reviewer: { ... } } }
  activeProfile: null | "deep-planning"
  profiles:
    deep-planning:
      stages:
        default:  { provider, model, reasoningEffort }
        planning: { provider, model, reasoningEffort }
        subagent: { provider, model, reasoningEffort }
```

写入路径统一走 `settings/update`（source 标记为 `update`），外部程序改动经 `settings/updated` 事件回流 UI，避免双写竞争。

## 8. UI 设计

信息架构沿用参考截图的「使用 / 接入 / 用量统计」三标签结构，本插件落在「使用」标签：

```
使用模型
  ├─ 默认模型            [模型选择器]  （说明：用于新建会话；已有会话沿用各自选择）
  ├─ 独立规划模型        [使用当前模型（单模型）▾ / 选择模型…]
  │      下方标注：当前规划模型 = deepseek-v4-flash · 思考档位 high
  ├─ 子代理模型          [模型选择器]
  ├─ 子代理思考档位      [默认（模型服务默认）▾ | low | medium | high …]
  │      （选项随所选模型动态生成；含角色覆盖入口）
  └─ 场景预设            [无 ▾ | 深度规划 | 快速日常 | …]

Agent 运行（本插件只读提示区）
  └─ 「嵌套深度 / 并发数 / 压缩阈值由客户端基础设置管理」
```

交互规则：

- 模型选择器列出已配置密钥的 provider 及其模型；未设密钥的项可展示但保存时给出告警。
- 每个模型选择后，思考档位下拉刷新为该模型 adapter 公布的档位。
- 「独立规划模型」保持参考图的两态：单模型（跟随默认）或独立指定。
- 保存前逐项校验，失败项内联标注，不整页阻断。
- 页面顶部展示「生效范围」提示：配置影响新会话与新派发的子代理。

## 9. 校验、降级与一致性

- **保存时校验**：provider 路由存在、model 属于该 provider、effort 属于该 model 的档位列表。
- **运行时降级**：阶段绑定指向的 provider 不可用时，回退 default 阶段绑定，并通过状态栏/事件通知用户；不静默失败。
- **一致性**：插件写入 default 阶段等价于写引擎 `agentDefaultModel`，两个入口（本插件 UI 与引擎原生 `/model`）看到同一数据；`settings/updated` 保证跨入口刷新。
- **卸载行为**：保留用户数据节但停止所有桥接；重装后配置还原。卸载即回退引擎默认行为。

## 10. 测试与验收

- 单元测试：schema 校验、优先级链解析、profile 合并、迁移。
- 桥接测试（fake Cordis context）：plan mode 进出切换的选择快照断言、子代理想定模型注入、显式声明不被覆盖。
- 集成验收（真实客户端加载插件后）：
  1. 设置 default 模型 → 新会话使用该模型（与 `/model` 查询一致）
  2. 设置 planning 独立模型 → plan mode 激活后下一步请求走规划模型，退出后还原
  3. 设置 subagent 模型与 effort → task 派发的子代理请求头为该模型与档位
  4. 禁用插件 → 所有阶段回到引擎默认，无残留选择
  5. 商城安装/更新/卸载全链路无报错

## 11. 里程碑

| 阶段 | 内容 | 依赖 |
|---|---|---|
| M1 | schema + resolver + default 阶段直写引擎设置 | 无（引擎能力已具备） |
| M2 | Plugin Host API 缺口落地（§6.3 P0 项） | 客户端侧配合 |
| M3 | planning / subagent 桥接 + 档位联动 UI；degeneration-guard 插件（平面 A 升级阶梯 + 平面 B 检测器）同步启动 | M2 |
| M4 | guard 升级阶梯全量交付（自动重试 + 暂停决策 UI）；Profile、角色覆盖、商城发布 | M3 |
| M5 | evaluation 阶段（依赖 Q4 决策） | M4 |

注：会话轮次上限（超限提醒）已随 guard 插件在 M4 交付，不再单独成阶段。

## 12. 重复输出检测与自动停止（Degeneration Guard）

> 回答评审问题：「是否可以检测模型一直重复输出然后停止思考？」——**可以，且业内已有分层先例。**

### 12.1 引擎现状与缺口

| 能力 | 引擎现状 | 缺口 |
|---|---|---|
| 工具调用重复检测 | `repeat-tool-reminder`：同工具+同规范参数连续重复计数（阈值 [3,5,8]），注入升级提醒 | 仅 advisory，永不否决；无强制停止出口 |
| 工具超时 | `timeout-policy`：按 `timeoutMs` 映射 `TOOL_TIMEOUT` | 不覆盖模型输出流 |
| 文本/思考流重复检测 | **无** | 需插件实现 |
| 会话级轮次上限 | **未发现**（LangGraph 有 `recursion_limit` 默认 25，OpenAI Agents SDK 有 `max_turns`） | 需插件补充 |
| 请求中断 | Agent 支持AbortSignal | 中断入口需经 Plugin Host API 暴露 |

### 12.2 两个检测平面

**平面 A：工具调用级（升级引擎已有能力）**

引擎 `repeat-tool-reminder` 负责提醒，插件补「升级阶梯」：

```
第 3 次（引擎）：短提醒
第 5 次（引擎）：详细提醒（含参数预览）
第 8 次（引擎）：强提醒
第 N 次（插件，可配）：强制暂停该步骤 + 通知用户
         （N 默认 12；用户可选「仅提醒不暂停」）
```

强制暂停不是否决单次调用（引擎语义禁止），而是在 `agent/pre-step` 边界拒绝继续，并向用户展示「模型疑似卡循环：工具 X 以相同参数连续调用 N 次」，提供「继续 / 注入反循环提示后重试 / 终止会话步骤」三个操作。与 Claude Code 的「appears to be stuck in a loop」自动停止行为对齐。

**平面 B：思考流检测（新增，插件实现；Q2 已定不覆盖最终文本）**

在流式 delta 上做客户端 n-gram 循环检测，参照 vLLM `RepetitionDetectionParams` 的三参数语义：

```
检测器参数（默认值，档位化见 12.4）：
  minPatternSize = 24   字符（约一短句）
  maxPatternSize = 1024 字符
  minCount      = 3     连续重复次数
  windowChars   = 16384 滚动窗口上限
```

算法：
1. 对 delta 做空白规范化后追加到滚动缓冲区。
2. 在尾部查找周期：若尾部 [L, 2L) 与 [2L, 3L) 与 [3L, 4L) 逐字符相等（L ∈ [minPatternSize, maxPatternSize]），判定循环。
3. 命中即触发升级阶梯；窗口滚动丟弃头部，内存有界。

另设两条硬兑底（不受 n-gram 检测影响）：
- **思考段长度上限**：单个 reasoning segment 超过 `maxThinkingChars`（默认 64k，可调）触发同阶梯；对应 vLLM `thinking_token_budget` 思路。
- **无进展输出上限**：单次响应超过 `maxResponseChars`（默认 256k）触发同阶梯。

### 12.3 触发后的升级阶梯（关键设计）

原则：**不静默、不丢失、可恢复**。每一级都写入会话日志（`{kind:'plugin'}` 来源标注），与引擎 repeat-tool-reminder 的可审计语义一致。

```
L1 检测命中：自动中断本次请求（AbortSignal），保留已生成内容
L2 自动重试一次：注入反循环上下文（「你在重复相同内容，请直接总结并结束」）
   —— 仅平面 B 且首次命中时
L3 重试仍命中/平面 A 强制阈值：暂停步骤，交用户决策
   （继续 / 换模型重试 / 终止步骤）
```

自动重试仅一次，避免「检测器与模型互相拉锯」的二级循环。

### 12.4 配置与档位

```
degenerationGuard:
  mode: "off" | "standard" | "strict"   # 默认 standard
  # standard：提醒 + 12次工具暂停 + 流式检测默认参数 + 30轮提醒
  # strict：更敏感参数 + 思考段上限减半 + 轮次提醒提前（20轮）
  # off：完全旁路（含引擎提醒照常，仅插件侧干预关闭）
  toolHardStop: 12        # 0 = 仅提醒
  stream: { minPatternSize, maxPatternSize, minCount }
  maxThinkingChars: 65536
  maxResponseChars: 262144   # 仅输出长度兑底，非重复检测
  maxTurnsPerSession: 30   # 超限提醒，不强停（Q3 已定）
  allowlistTools: [todo_write]   # 合法重复工具，与引擎 exclude 语义对齐
```

**检测范围（Q2 已定）**：n-gram 循环检测只作用于思考流与工具调用参数，不作用于最终文本输出；最终文本仅受 `maxResponseChars` 长度兑底约束。

误报防线：代码/诗歌/表格等合法重复场景由「模式长度 ≥ 24 字符且连续 ≥ 3 次完整周期」的保守判定避免；仍误报时用户可选 off 或调参。允许按会话临时关闭（与阶段配置不同，guard 档位允许会话内即时切换，因为它是对运行时故障的响应而非路由偏好）。

### 12.5 工程归属：独立 guard 插件

建议以 `com.my-dsh.degeneration-guard` 独立插件实现，不并入 model-config：

- 职责不同：model-config 是路由配置（写设置），guard 是运行时观测与干预（挂事件、持检测器状态）
- 引擎有 `guard/` 包生态先例（repeat-tool-reminder、timeout-policy），插件侧对称划分
- 可独立禁用：重度用户可关掉 guard 而保留路由
- 两者通过设置命名空间共享 allowlistTools 等少量约定字段

两个插件同一里程碑内交付，但包、manifest、权限独立。guard 插件新增权限：`session.observe`（流式 delta 订阅）、`agent.interrupt`（AbortSignal 出口）——后者需 Plugin Host API 定义明确语义，是 P0 缺口。

### 12.6 借鉴来源

| 实践 | 来源 | 采纳点 |
|---|---|---|
| 卡循环检测→提醒→自动停止升级阶梯 | Claude Code（stuck in a loop 自动停止） | §12.2 平面 A、§12.3 |
| 重复 n-gram 检测三参数（min/max pattern size, min count） | vLLM `RepetitionDetectionParams` | §12.2 平面 B 算法 |
| 请求级思考预算 | vLLM `thinking_token_budget` | 思考段长度上限兑底 + schema 预留 |
| 会话轮次上限 | LangGraph `recursion_limit`(25)、OpenAI Agents SDK `max_turns` | 会话级轮次上限（见开放问题 Q1） |
| 停止条件须可从 transcript 验证（30 轮事故） | Claude Code /goal 事故分析（issue #58348） | 评估阶段证据化判定原则 |
| 五层防护：预算→检测→提醒→强制→人工 | ReAct 循环防护模式综述 | §12.3 升级阶梯分层 |

## 13. 开放问题

### 13.1 待上游/客户端确认（技术事实类）

1. plan mode 激活事件是否已在上游会话事件面暴露，还是需要客户端在 UI 层代发？（决定 M2 的桥接深度）
2. 压缩阶段（compaction）是否值得接入独立模型？需评估引擎压缩请求的模型来源。
3. 子代理角色（reviewer/worker 等）的可枚举集合从哪个 seam 读取最稳定？
4. `model.switch` 权限的确认粒度：每会话首次切换是否需要用户可见提示？
5. 引擎 Agent 是否存在我们尚未找到的会话轮次上限？（搜过 agent-loop 未发现 maxTurns；若确实没有，轮次上限由 guard 插件实现）
6. 流式 delta 事件（含 reasoning segment 边界）在 Plugin Host API 事件面如何暴露？guard 的平面 B 依赖它。

### 13.2 产品决策记录（2026-08-21 评审已确认）

- **Q1 自动干预强度：已定** — 中断 + 自动重试一次（注入反循环提示）+ 仍命中则交用户。即 §12.3 阶梯 L2 默认启用。
- **Q2 检测范围：已定** — 思考流 + 工具调用。**最终文本不做 n-gram 检测**（代码/表格是合法重复重灾区），仅保留 `maxResponseChars` 输出长度兑底。
- **Q3 会话轮次上限：已定** — 纳入 guard 默认配置，默认 30 轮，**超限提醒不强停**（用户可继续）。
- **Q4 degeneration-guard 工程归属：已定** — 独立插件 `com.my-dsh.degeneration-guard`，与 model-config 同期交付、分包上架。

### 13.3 待用户决策（产品取舍类）

- **Q4 evaluation 阶段默认模型**：评估阶段不配置时，回退 default（当前方案）还是默认推荐轻量模型（需产品上有推荐表）？
- **Q5 guard 档位可见度**：三档（off/standard/strict）+ 高级参数折叠，还是全量参数暴露？（影响 UI 与支持成本）
