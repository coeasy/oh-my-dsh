# oh-my-dsh 优化改进计划（总纲）

> 编制日期：2026-08-19
> 范围：`D:\workspace\oh-my-dsh` 全仓库（apps/desktop、apps/vscode、packages/client-runtime、plugins/embedded-client、plugins/plugin-marketplace、scripts、runtime）
> 文档结构：

| 文档 | 内容 | 优先级 |
|---|---|---|
| [optimization-size.md](optimization-size.md) | 安装包体积优化（当前最痛点） | ★★★★★ P0 ✅ |
| [optimization-tests.md](optimization-tests.md) | 插件市场测试补齐 + 关键路径单测 | ★★★★★ P0 ✅ |
| [optimization-security.md](optimization-security.md) | 安全加固（npm integrity、引擎校验、CSP） | ★★★★☆ P1 ✅ |
| [optimization-ux.md](optimization-ux.md) | 用户体验改进（加载/安装进度、离线、引导） | ★★★☆☆ P2 ✅ |
| [optimization-engineering.md](optimization-engineering.md) | 工程化改进（CI、依赖、E2E、版本管理） | ★★★☆☆ P2 🔄 |

> ✅ 已完成　🔄 部分完成（详见各分项文档末尾的“落地状态”）

## 现状诊断摘要

### 安装包体积（P0，最痛点）

实测产物（Windows）：

| 组件 | 大小 | 占比 |
|---|---|---|
| `runtime/payload/harness`（DSH 克隆展平） | **894 MB** | ~68% |
| `node.exe`（Node 运行时） | **86 MB** | ~7% |
| `my-dsh.exe`（Electron 本体） | **202 MB** | ~15% |
| `locales`（Chromium 语言包） | **45 MB** | ~3% |
| 其他 DLL/pak/icu | ~100 MB | ~7% |
| **win-unpacked 解压总大小** | **1.3 GB** | — |
| **Setup.exe（NSIS 压缩后）** | **200 MB** | — |
| **portable.exe** | **199 MB** | — |
| **win.zip** | **378 MB** | — |

**根因**：`scripts/stage-payload.mjs` 把整个 DSH 克隆（含各 package 的 node_modules 依赖与编译产物）展平进 `runtime/payload/harness`，再整体塞入安装包。虽已排除 `.git/website/docs/tests/python/native` 等目录，node_modules 与 web 编译产物仍占 894MB。

### 测试覆盖缺口（P0）

- 全仓 44 个测试文件（desktop 29 + client-runtime 13 + vscode 2 + embedded 1），**插件市场 0 测试**。
- `plugins/plugin-marketplace/src/` 约 1200 行核心逻辑（dshHomeOf 路径解析、安装/卸载/备份/校验/前端状态机）完全无单测覆盖。

### 安全薄弱点（P1）

- `verify.ts` 仅校验 lifecycle scripts 与 npm squat，未校验包 `dist.integrity` 或发布者身份。
- `engine-updater` 下载引擎未校验签名/checksum manifest。
- 桌面端 preload/窗口安全策略需复核（`contextIsolation`/`sandbox`/`nodeIntegration`）。

### 体验与工程化（P2）

- 市场加载已实现渐进式 + 进度提示，但安装过程无实时进度条。
- 在线数据源全部失败时无明确离线提示。
- 无桌面端 E2E 测试（仅 VS Code 有）。
- README / 首次启动引导薄弱。

## 优先级总览（ROI 排序）

| 优先级 | 事项 | 理由 | 预估工作量 |
|---|---|---|---|
| ★★★★★ | 2 体积优化（剥离源码/按需下载/最大压缩） | 直接影响下载与安装体验，200MB→≤80MB | 1–2 天 |
| ★★★★★ | 3 插件市场单测 | 核心逻辑零覆盖，回归风险高 | 0.5–1 天 |
| ★★★★☆ | 4 安全加固（integrity/签名/CSP 复核） | 分发产品的可信度与合规 | 1 天 |
| ★★★☆☆ | 5 体验改进（进度条/离线/引导） | 提升用户满意度 | 1 天 |
| ★★★☆☆ | 6 工程化（E2E/CI/依赖审计） | 长期质量保障 | 1–2 天 |

## 执行顺序

按 `P0 → P1 → P2` 顺序推进，每个优化项验收通过后合入主分支再进入下一项，避免同时改动引入回归。详细步骤见各分项文档。
