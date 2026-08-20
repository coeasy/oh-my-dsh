# P0：安装包体积优化

> 目标：Setup.exe 由 200MB 降至 ≤80MB，portable/zip 同步缩减。
> 优先级：★★★★★（直接影响下载与安装体验）。

## 现状与根因

| 组件 | 大小 | 说明 |
|---|---|---|
| `runtime/payload/harness` | 894MB | DSH 克隆展平（含各 package 的 node_modules 与 web 编译产物） |
| `node.exe` | 86MB | 运行时依赖，无法剥离，可考虑复用 Electron 自带 Node 或精简 |
| Electron 本体 | 202MB | `my-dsh.exe`，压缩后占比下降 |
| `locales` | 45MB | 只用到少数语言，可裁剪 |
| **Setup.exe** | **200MB** | 压缩后 |

**根因链路**：`scripts/stage-payload.mjs` → 展平整个 DSH 克隆 → `runtime/payload/harness`（894MB）→ `electron-builder.yml` 的 `win.extraResources` 整体打入安装包。

## 优化方案（可组合）

### A1. 按需下载 Harness 运行时（推荐，收益最大）

**思路**：安装包不再内置 894MB harness，改为首次启动时从 GitHub Release 下载已编译的 harness 压缩包（约 30–60MB），解压到用户缓存目录（`~/.dsh-client/runtime`），加 checksum 校验与版本缓存。

- **收益**：安装包直接 -894MB，Setup.exe 可降至 ~60MB。
- **实现**：
  1. 发布流程新增 `harness-<version>-<platform>.tar.gz` 产物（由 CI 对克隆精简后压缩，仅含运行所需：`apps/cli/lib/bin.js`、`dsh-app-boot`、web dist、最小 node_modules）。
  2. 客户端 `engine-updater.ts` / `download.ts` 增加"首次下载+解压+校验"分支。
  3. `launch-config.ts` 解析 runtime 时，若 bundled 缺失则回退 download 模式（已有 `DSH_RUNTIME=download` 通道，复用 `DSH_RUNTIME_URL`/`DSH_RUNTIME_CACHE`）。
  4. 断网/失败时给出明确提示与重试入口。
- **验收**：全新机器联网首启可自动拉取引擎；断网时提示而非崩溃；安装包 ≤80MB。

### A2. 精简内置 Harness（若保留内置，作为 A1 的降级方案）

在 `stage-payload.mjs` 展平前进一步裁剪：

- `copy-harness.mjs` 的 `STAGE_EXCLUDE_DIRS` 增加：`**/node_modules/.cache`、`**/dist/*.map`、`apps/cli/node_modules/**/test`、`**/*.d.ts`（保留声明按需评估）。
- 对 `apps/web/dist` 做 `--minify` 复检；去掉非必需的 `locales`。
- `pnpm prune --prod` 级别精简（在克隆只读约束下，改为展平后清理无用依赖目录）。
- **预估收益**：-300~500MB，Setup.exe 可降至 ~100–120MB，但不如 A1 彻底。

### A3. 精简 Electron 运行时（辅助，必做）

- `locales`：electron-builder 通过 `win.extraResources` 不拷贝，改用 `electron-builder` 的 `electronLanguages`（或打包后删除除 `zh-CN`/`en-US` 外全部语言包）。**-40MB**。
- 确认 `asar: true` 已生效（当前已开启）；核对 `files` 白名单只含 `out/main.js`、`out/preload.cjs`、`package.json`（当前已配置）。
- 关闭 `electron-builder` 默认附带的多余资源（如 `LICENSES.chromium.html` 可保留）。

### A4. 提升压缩等级（必做，改动最小）

- `electron-builder.yml`：`compression: normal` → `compression: maximum`（LZMA2 高压缩）。
- **预估收益**：Setup/portable 再 -10~20%，zip 略增压缩时间但体积下降。
- 注意：`compression: maximum` 会显著增加打包耗时（当前 NSIS 已较慢），CI 可接受。

### A5. 复用 Electron 自带 Node（可选）

- Electron 运行时已内嵌 Node，若 dsh web 可用 Electron 的 Node 启动，可去掉独立的 86MB `node.exe`。
- 需验证 dsh CLI 脚本与 Electron Node 版本兼容性；风险较高，列为远期探索。

## 推荐实施路径

| 步骤 | 动作 | 依赖 |
|---|---|---|
| 1 | A4 压缩改 maximum + A3 裁剪 locales | 无 |
| 2 | A1 按需下载 harness（核心收益） | 需先建 Release 压缩产物与校验链 |
| 3 | （可选）A5 复用 Electron Node | 需兼容性验证 |

## 验收标准

- [ ] `Setup.exe` ≤ 80MB（联网首启自动拉取引擎），离线场景有明确提示。
- [ ] `portable.exe`、`win.zip` 同比例缩减。
- [ ] 全新环境 `pnpm pack:desktop` 后安装运行，`dsh web` 正常拉起，插件市场可用。
- [ ] `pnpm verify` 全绿。
