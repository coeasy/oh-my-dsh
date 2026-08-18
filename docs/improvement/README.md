# oh-my-dsh 改进优化计划（总纲）

> 编制日期：2026-08-18
> 范围：D:\workspace\oh-my-dsh 全仓库（apps/desktop、apps/vscode、packages/client-runtime、plugins/embedded-client、scripts、runtime、docs）
> 文档结构：

| 文档 | 内容 | 周期 |
|---|---|---|
| [phase-1-engineering-hygiene.md](phase-1-engineering-hygiene.md) | 工程清理与快速胜利 | 1 周 |
| [phase-2-quality-hardening.md](phase-2-quality-hardening.md) | 质量与体验加固（E2E、签名、版本化、性能、i18n） | 2–4 周 |
| [phase-3-feature-expansion.md](phase-3-feature-expansion.md) | 功能扩展（JetBrains、自动更新、手机桥、多会话） | 1–3 月 |
| [phase-4-long-term.md](phase-4-long-term.md) | 长期方向（瘦身分发、企业包、插件市场、遥测） | 3 月+ |

## 现状诊断摘要

### 工程卫生问题（立即处理）

- `runtime/` 堆积陈旧产物：`payload.stale-20260817103317`、`payload.stale-cycle`、`payload.stale-explode`、`stage.broken`；单 `payload` 550MB
- `tests/generated` 目录无清理策略
- README 三段重复展示同一组构建命令

### 功能短板

- 无 JetBrains 支持；引擎更新需整包重装；全量打包 550MB+ 启动慢
- LAN 手机桥接未完成（关闭状态）；无中文化；诊断能力有限

### 工程化短板

- 无 E2E 测试（现有约 50 个测试全为单元级）
- 版本联动靠 "all 0.1.0" 约定，无 changesets 自动化
- 无代码签名（Windows SmartScreen / macOS Gatekeeper 会拦截）
- 无引擎兼容矩阵（上游 developer preview，明确有破坏性变更）
- 新图标尚未接入 VSIX 与 electron-builder

## 优先级总览（ROI 排序）

| 优先级 | 事项 | 理由 |
|---|---|---|
| ★★★★★ | Phase 1 全部 | 零风险、当天见效 |
| ★★★★★ | 2.1 E2E 冒烟、2.3 代码签名 | 分发产品的可信度生死线 |
| ★★★★ | 2.5 启动优化、3.2 引擎自动更新 | 直接决定用户留存 |
| ★★★ | 3.1 JetBrains、3.3 手机桥接 | 扩大入口，工时大 |
| ★★ | 中文化、遥测、单二进制 | 按资源排期 |

## 执行状态（2026-08-18）

| 项 | 状态 | 说明 |
|---|---|---|
| Phase 1 工程清理 | ✅ 已完成 | runtime 陈旧产物已清、图标接入、README 去重、hygiene 增强、兼容矩阵 |
| Phase 2.1 E2E 骨架 | ✅ 已落地 | `tests/e2e/` + `e2e.yml` 三平台 CI |
| Phase 2.2 changesets | ✅ 已落地 | `.changeset/` + `version.yml` |
| Phase 2.4 诊断健康自检 | ✅ 已落地 | `health-check.ts` + 单测 |
| Phase 2.6 全量中文化 | ✅ 确认已完成 | 壳层 main/托盘/splash/setup/手机桥接页全双语，SPA 返回 zh-CN |
| **白屏深度修复** | ✅ 已修复并验证 | 见 [white-screen-fix.md](white-screen-fix.md)；flatten 漏包导致引擎崩溃 |
| Phase 2.3 代码签名 | ⏳ 待外部证书 | 需 Windows EV + Apple Developer 账号 |
| Phase 3.2 引擎自动更新 | 🔵 已实现 | `engine-updater.ts`（下载/校验/激活/回滚，7 测试）+ main.ts IPC 集成；端到端激活待发布基建 |
| Phase 3.3 手机桥接 | ✅ 已实现 | LanMobileBridge + Connect Phone 流程，测试通过 |
| Phase 4 瘦身/企业/插件市场 | ⏳ 部分推进 | flatten 已按宿主平台过滤原生包（瘦身贡献） |

## 执行原则

1. **每个阶段有独立验收标准**（见各文档末尾），未通过不进入下一阶段
2. **所有改动先补测试再动代码**（项目现有测试基线：`pnpm test` 三平台绿）
3. **上游破坏性变更风险**：一切依赖引擎行为的任务以 `engine.lock.json` 锁定基线开发
4. 签名证书（Windows EV / Apple Developer）需在 Phase 2 开始前 1–2 周启动申请
