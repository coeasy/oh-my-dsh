# Phase 1：工程清理与快速胜利（1 周内）

> 目标：零风险清理 + 品牌统一 + 风险文档补齐。全部任务可并行，当天见效。

## 1.1 清理 runtime 陈旧产物（0.5 天）

**现状**：`runtime/` 下存在 `payload.stale-20260817103317`、`payload.stale-cycle`、`payload.stale-explode`、`stage.broken` 共 4 个陈旧目录，与在用的 `payload`（550MB）、`stage` 并存，易误用且占用数 GB 磁盘。

**步骤**：

1. 确认各 stale 目录不在任何脚本引用中：
   ```bash
   grep -rn "stale" scripts/ apps/ packages/ plugins/ --include="*.mjs" --include="*.ts"
   ```
2. 删除前先备份关键差异（仅当 grep 有引用时才需要）：
   ```bash
   diff -rq runtime/stage runtime/stage.broken | head -50
   ```
3. 删除陈旧目录（Windows，Git Bash）：
   ```bash
   rm -rf runtime/payload.stale-20260817103317 runtime/payload.stale-cycle runtime/payload.stale-explode runtime/stage.broken
   ```
4. `.gitignore` 增加防御规则（若尚未覆盖）：
   ```gitignore
   runtime/payload*/
   runtime/stage*/
   !runtime/payload/.gitkeep
   !runtime/stage/.gitkeep
   ```
5. `scripts/check-hygiene.mjs` 增加检查：发现 `runtime/*.stale-*`、`runtime/*.broken` 目录即报错退出，防止复发。

**验收**：`pnpm hygiene` 通过；`runtime/` 仅剩 `payload`、`stage`（+ gitkeep）。

## 1.2 图标接入与品牌统一（0.5 天）

**现状**：已设计新图标（深蓝电路 + 霓虹六边形 + 神经节点光芯），尚未接入任何打包配置。

**步骤**：

1. 将图标源文件（1024px PNG）复制到仓库：`apps/desktop/build/icon.png`、`apps/vscode/media/icon.png`（如目录不存在则创建）。
2. `apps/desktop/package.json`（或独立 electron-builder 配置）：
   ```json
   {
     "build": {
       "appId": "com.dsh.desktop",
       "productName": "DeepSeek Harness",
       "files": ["out/**"],
       "win": { "icon": "build/icon.png" },
       "mac": { "icon": "build/icon.png" },
       "linux": { "icon": "build/icon.png", "category": "Development" }
     }
   }
   ```
   注意：NSIS/mac 实际需要 `.ico` / `.icns`，用 `png2icons` 或 ImageMagick 转换：
   ```bash
   npx png2icons build/icon.png build/icon -all
   ```
3. `apps/vscode/package.json`：
   ```json
   { "icon": "media/icon.png", "galleryBanner": { "color": "#0a1f3d", "theme": "dark" } }
   ```
4. 重打包验证：`pnpm pack:vscode && pnpm pack:desktop`，肉眼检查 VSIX 列表项与 exe/dmg 图标。

**验收**：三平台安装包与 VSIX 均显示新图标；`pnpm verify` 通过。

## 1.3 README 去重（0.5 天）

**现状**：README.md 中 `.\build-clients.cmd` 命令块重复出现 3 次。

**步骤**：

1. 合并为一张跨平台对照表：

   | 操作 | Windows | macOS / Linux |
   |---|---|---|
   | 构建（stable） | `.\build-clients.cmd` | `./build-clients.sh` |
   | 构建（latest release） | `.\build-clients.cmd latest` | `./build-clients.sh latest` |
   | 构建（lock 钉死） | `.\build-clients.cmd lock` | `./build-clients.sh lock` |
   | 安装 VSIX | `.\install-clients.cmd` | `./install-clients.sh` |

2. PowerShell 专属说明（`$env:DSH_INSTALL='1'` 等）合并到"环境变量"一节，只讲一次。

**验收**：README 无重复命令块；所有示例命令逐一可执行。

## 1.4 tests/generated 治理（0.5 天）

**步骤**：

1. 审计 `tests/generated` 内容与生成来源（哪个测试写入）：
   ```bash
   grep -rn "tests/generated" --include="*.ts" --include="*.mjs" .
   ```
2. 测试内改为系统临时目录（`os.tmpdir()` + `fs.mkdtemp`）或显式 `afterEach` 清理。
3. `.gitignore` 增加 `tests/generated/`；hygiene 脚本检查其不存在（除 .gitkeep）。

**验收**：`pnpm test` 后 `tests/generated` 自动清空；hygiene 通过。

## 1.5 引擎兼容性矩阵文档（1 天）

**背景**：上游 DeepSeek Harness 处于 developer preview，README 明确 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。本项目必须显式声明支持范围，否则用户升级引擎后客户端黑盒崩溃。

**步骤**：新建 `docs/compatibility.md`，包含：

1. **矩阵表**：

   | 客户端版本 | 引擎来源 | 引擎 ref / tag | 验证状态 | 已知问题 |
   |---|---|---|---|---|
   | 0.1.0 | GitHub master@<commit> | engine.lock.json 记录值 | CI 三平台绿 | — |

2. **降级指引**：引擎更新失败时的三档回退（`DSH_ENGINE_REF` 钉 tag → `lock` 模式 → 保留已构建克隆），引用现有 `build:clients:lock` 流程。
3. **破坏性变更跟踪流程**：每次上游 release，跑 `pnpm smoke:engine` + E2E 冒烟，结果回填矩阵；不兼容则锁旧版并在矩阵标注。
4. CI 集成：weekly scheduled job 用 latest 引擎跑冒烟，失败自动开 issue。

**验收**：文档合入主分支；weekly CI job 生效。

## Phase 1 总验收

- [ ] `pnpm hygiene && pnpm test && pnpm verify` 全绿
- [ ] `runtime/` 无 stale/broken 目录，磁盘回收 ≥1GB
- [ ] 三端图标统一
- [ ] `docs/compatibility.md` 存在且 CI 每周刷新
