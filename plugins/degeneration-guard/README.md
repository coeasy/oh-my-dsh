# @dsh/plugin-degeneration-guard

DeepSeek Harness **Degeneration Guard** 独立插件：检测模型陷入重复输出/死循环并自动停止。

以**独立 Cordis 插件**形态运行，**不修改上游 DeepSeek Harness**。它观测流式输出与工具调用，不保存任何 Prompt / Response / API Key。

> 维护约定（2026-08）：本插件以**桌面客户端为主、共享 Web UI 展示即可**，与 usage-analytics 一致。

## 1. 设计依据

完整方案见 `docs/dsh-model-config-plugin-plan.md` §12。要点：

- **平面 A（工具级）**：连续相同调用（同工具 + 同规范参数）计数，阈值提醒 + 硬停止阈值暂停；被排除工具对链透明（不计数也不重置）。
- **平面 B（思考流）**：n-gram 循环检测（`minPatternSize`/`maxPatternSize`/`minCount`，参照 vLLM `RepetitionDetectionParams`），外加思考段/响应长度兜底。
- **升级阶梯**：首次命中 → 中断 + 自动重试一次（注入反循环提示）→ 再次命中/硬停止 → 暂停交用户决策。**不静默、不丢失、可恢复**。
- **轮次上限**：默认 30 轮，超限**提醒不强停**（产品决策 Q3）。
- **档位**：`off`（完全旁路）/ `standard` / `strict`。

## 2. 目录

| 路径 | 说明 |
|---|---|
| `src/types.ts` | 配置 / 事件 / 状态 / seam 类型 |
| `src/buffer.ts` | 有界滚动缓冲区 + 空白归一化 |
| `src/ngram.ts` | n-gram 循环检测（纯函数） |
| `src/tool-chain.ts` | 工具重复链（阈值提醒 + 硬停止） |
| `src/turn-limit.ts` | 会话轮次计数（提醒不强停） |
| `src/escalation.ts` | 升级阶梯状态机（L1/L2/L3） |
| `src/core.ts` | 核心引擎（接线所有检测器） |
| `src/index.ts` | Cordis 入口 + `degenerationGuard` 服务 |
| `src/manifest.ts` / `manifest.json` | manifest 结构与权限白名单校验 |
| `ui-src/mount.ts` / `ui/bundle.js` | 状态/设置页 UI bundle |
| `tests/` | 49 个单元测试 |

## 3. 构建 / 测试 / 打包

```bash
# 仓库根目录
pnpm test:degeneration-guard    # 插件全部测试
pnpm build:degeneration-guard   # 重建 UI bundle
pnpm pack:degeneration-guard    # manifest 校验 + 重建 UI + tar + sha256 + 签名模板
```

打包产物在 `dist/plugins/com.my-dsh.degeneration-guard-0.1.0.tgz(.sha256/.signed.json)`。

## 4. 服务 API（宿主接线）

插件暴露 `degenerationGuard` 服务：`getStatus` / `setMode` / `updateConfig` / `feed` / `feedToolCall` / `noteStep` / `resetSegment` / `resetSession` / `resume` / `isPaused` / `interruptNow`。

宿主接线方式见 `docs/dsh-plugin-host-adapter.md`。`InterruptSeam`（AbortSignal 出口）与 `ReminderSeam`（反循环提示注入）缺省时插件降级为「仅提醒、不中断」，不崩溃。

## 5. 权限与安全

manifest 权限白名单：

```
session.observe  agent.interrupt  events.subscribe  ui.mount
```

显式禁止：`network.any`、`filesystem.any`、`native_code`、`process.spawn`、`credential.read`。

`agent.interrupt` 语义（由宿主保证）：仅允许中断**当前步骤正在进行的请求**（对应引擎 Agent 的 AbortSignal 边界），中断后已生成内容保留、可从暂停点恢复。
