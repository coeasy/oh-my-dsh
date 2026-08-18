# 引擎兼容性矩阵

> 维护：每次上游 DeepSeek Harness release 后更新。
> 背景：上游处于 developer preview，README 明确声明 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。本矩阵是客户端与引擎版本的安全契约，升级与降级均以此为准。

## 矩阵

| 客户端版本 | 引擎来源 | 引擎 ref / tag | 验证状态 | 已知问题 / 备注 |
|---|---|---|---|---|
| 0.1.0 | GitHub stable | `engine.lock.json` 记录值 | CI 三平台绿 | — |

> 真实 ref 以 `engine.lock.json` 与 `pnpm fetch:engine` 的解析结果为准。CI weekly job 会自动用 latest 引擎跑冒烟并回填结果。

## 引擎获取优先级（自建回退链）

1. GitHub **stable**（最新非预发布；只有 rc 则用最新 Release）
2. `git ls-remote --heads` 的 `master` / `main`（无 Release/tag 时）
3. `engine.lock.json`（兜底钉死）

## 降级指引

| 场景 | 操作 |
|---|---|
| 引擎更新失败 | 保留已构建克隆（除非 `DSH_FETCH_ENGINE_FORCE=1`），回退到上一可用版本 |
| 需要锁定特定版本 | `DSH_ENGINE_REF=<tag/branch>` 钉死；或 `pnpm build:clients:lock` 只用 `engine.lock.json` |
| 客户端与引擎不兼容 | 用上一兼容引擎 ref，并在本矩阵"已知问题"列登记，同时向上游提交 issue |

## 破坏性变更跟踪流程

1. 上游发布 release → 触发 weekly CI 冒烟（`smoke:engine` + E2E）
2. 冒烟绿 → 更新矩阵"验证状态"列；红 → 锁定旧引擎版本并在矩阵标注
3. 每次矩阵更新随 PR 合入，并同步 CHANGELOG

## 相关链接

- 构建命令：`docs/one-click-clients.md`
- 架构与进程模型：`docs/architecture.md`
- 发布流程：`docs/publishing.md`
