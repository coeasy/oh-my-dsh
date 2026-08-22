# @dsh/plugin-model-config

DeepSeek Harness **Model Config** 独立插件：分阶段模型路由（默认 / 规划 / 子代理 / 评估）+ 思考档位 + 场景预设（Profile）。

以**独立 Cordis 插件**形态运行，**不修改上游 DeepSeek Harness**；可独立安装 / 启用 / 禁用 / 更新 / 卸载。默认本地运行、不上传；不读取或保存任何 API Key（凭据管理归引擎 credentials 包）。

> 维护约定（2026-08）：本插件以**桌面客户端为主、共享 Web UI 展示即可**，与 usage-analytics 一致。

## 1. 设计依据

完整方案见 `docs/dsh-model-config-plugin-plan.md`。要点：

- **阶段**：`default`（新会话默认）、`planning`（规划阶段）、`subagent`（子代理）、`evaluation`（评估/停止条件判定，默认回退 default）。
- **思考档位**：`reasoningEffort` 来自 adapter 公布的 efforts 列表，缺省 = 服务方默认；`thinkingBudget` 为预留字段（vLLM `thinking_token_budget` 思路）。
- **优先级链**：会话内显式切换 > 会话保存选择 > Profile > 阶段独立设置 > follow 链 > 引擎 `agentDefaultModel` > Provider 默认。
- **桥接**：规划模型无引擎字段，经 `ModelSwitchSeam` 在步骤边界切换（plan mode 进出）；子代理默认注入经 `resolveChildModel` 纯函数。

## 2. 目录

| 路径 | 说明 |
|---|---|
| `src/types.ts` | 阶段 / binding / Profile / seam 类型 |
| `src/schema.ts` | 文档 schema 校验 + 默认值（fail loud） |
| `src/resolver.ts` | 优先级链解析（纯函数） |
| `src/catalog.ts` | provider/model/effort 目录校验 |
| `src/store.ts` | 原子持久化（file / settings-namespace / memory） |
| `src/migration.ts` | schema 版本迁移 |
| `src/planner-bridge.ts` | 规划模型热切换桥 |
| `src/subagent-bridge.ts` | 子代理默认注入桥 |
| `src/index.ts` | Cordis 入口 + `modelConfig` 服务 |
| `src/manifest.ts` / `manifest.json` | manifest 结构与权限白名单校验 |
| `ui-src/mount.ts` / `ui/bundle.js` | 设置页 UI bundle（平台无关） |
| `tests/` | 47 个单元测试 |

## 3. 构建 / 测试 / 打包

```bash
# 仓库根目录
pnpm test:model-config          # 插件全部测试
pnpm build:model-config         # 重建 UI bundle
pnpm pack:model-config          # manifest 校验 + 重建 UI + tar + sha256 + 签名模板
```

打包产物在 `dist/plugins/com.my-dsh.model-config-0.1.0.tgz(.sha256/.signed.json)`。

## 4. 服务 API（宿主接线）

插件暴露 `modelConfig` 服务：`getDocument` / `getResolved` / `getStatus` / `setStage` / `setProfile` / `saveProfile` / `deleteProfile` / `reset` / `applyDefaultToEngine` / `validate` / `resolveChild`。

宿主接线方式见 `docs/dsh-plugin-host-adapter.md`。所有 seam 均可缺省——缺省时插件优雅降级（如规划模型热切换关闭、仅配置存储生效），不会崩溃。

## 5. 权限与安全

manifest 权限白名单：

```
settings.read  settings.write  session.observe  model.switch
subagent.configure  events.subscribe  ui.mount
```

显式禁止：`network.any`、`filesystem.any`、`native_code`、`process.spawn`、`credential.read`。

数据安全：不保存 API Key；`model.switch` 仅允许在步骤边界切换选择（由宿主保证引擎 `installModelSelection` 快照语义）；`subagent.configure` 仅允许填充空缺省值、绝不覆盖子代理显式声明的模型。
