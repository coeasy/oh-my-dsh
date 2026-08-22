# P2：工程化改进

> 目标：CI 门禁、依赖审计、桌面端 E2E、版本管理规范化。
> 优先级：★★★☆☆。

## E1. CI 门禁完善

**现状**：`.github/workflows/` 有 `ci.yml`、`release.yml`、`version.yml`。

**方案**：
1. `ci.yml` 确保每个 PR 跑：`pnpm hygiene` + `pnpm typecheck` + `pnpm lint` + `pnpm format:check` + `pnpm test` + `pnpm verify`。
2. 新增 `pnpm audit` 作为安全门禁（见 C4）。
3. 明确 PR 必须附 changeset（用 `changeset status` 检查，除 `chore` 外）。

**验收**：PR 全部门禁可复现、CI 绿。

## E2. 桌面端 E2E 测试

**现状**：仅 `tests/e2e/vscode.e2e.mjs` 覆盖 VS Code。

**方案**：
1. 引入 Playwright（或现有 Electron 驱动）做桌面端冒烟：启动 → 加载 loopback → 市场打开 → 安装一个内置插件 → 状态为已安装 → 卸载。
2. 纳入 CI（Windows runner）。
3. 复用 `scripts/smoke-local.mjs` / `client-scenarios.mjs` 的现有场景扩展。

**验收**：桌面端关键用户路径有自动化 E2E。

## E3. 构建可复现性

**现状**：Electron 版本未显式钉死（随 electron-builder 解析）。

**方案**：
1. 在 `package.json` / lock 中显式声明 `electron` 版本，`electron-builder` 用固定 Node/Electron。
2. 提交 `pnpm-lock.yaml`（确认已提交），保证依赖可复现。
3. 体积优化后（A1）把 harness 版本/commit 写入 `origin.json` 并在 CI 校验。

**验收**：相同 commit 在干净环境可复现构建产物（比 SHA）。

## E4. 版本管理与发布

**现状**：`version:packages` 走 changesets，但需规范化。

**方案**：
1. 统一 semver 策略：客户端包 `0.1.x`，harness 引擎独立版本，映射关系写 `compatibility.md`。
2. `release.yml` 自动：打 tag → 构建三端 → 生成 `SHA256SUMS.txt` → 发布到 GitHub Releases。
3. 体积优化后把 harness 产物一并发布，供 A1 按需下载。

**验收**：一次 `git tag` 触发完整发布链路。

## E5. 文档与可维护性

**方案**：
1. 补齐 README 安装/使用/开发指南。
2. `client/index.ts`（1100+ 行）按需拆分：样式、词条、组件分离，降低维护成本（可放在后续重构）。
3. 为新增优化项补齐注释与验收。

**验收**：文档完善；关键文件结构清晰。

## 落地状态（2026-08-19）

- ✅ **E1/C4**：`ci.yml` 三平台矩阵跑完整门禁：hygiene + typecheck + lint + format:check + test + **`pnpm audit --prod --audit-level high` 安全门禁** + layer audit + compile；pack smoke 任务跑 VSIX 打包 + E2E。
- 🔄 **E2**：桌面端 E2E 仍未引入（Playwright 冒烟待排期）；VS Code E2E 已在 CI（`pnpm e2e`）。
- ✅ **E3**：electron 版本已显式钉死；`pnpm-lock.yaml` 已提交；引擎 ref 写入 `origin.json`（`engine-pin`/`product-version` 单测锁定）。
- ✅ **E4**：`release.yml` 打 tag → 三端构建 → `scripts/checksum-release.mjs` 生成 `SHA256SUMS.txt` → 上传 → `softprops/action-gh-release` 自动发布（draft）；更新检查对话框引导用户核对 SHA256SUMS。
- 🔄 **E5**：README（中英）+ CHANGELOG（中英）已补齐；`client/index.ts` 拆分暂缓。
- ✅ **F1**：一键本地构建修复 —— `compile:desktop` 现显式先构建市场包（`pnpm --filter @coeasy/dsh-plugin-marketplace build`），解决 fresh checkout 下 `copy-market.mjs` 因缺产物直接报错的问题；市场包 `build` 脚本由 `npm run` 改为 `pnpm run`，避免 pnpm workspace 内 bin 解析脆弱；`plugins/plugin-marketplace/{lib,client}/` 构建产物纳入 `.gitignore`。已本地验证 `pnpm compile`、`pnpm verify`、`pnpm pack:vscode`（产出 vsix）全链路通过。

另：`shutdown.ts` 修复 Windows 11 24H2+ 移除 wmic 导致的进程枚举失败 —— PowerShell `Get-CimInstance` 兜底 + 路径分隔符归一化（单测覆盖 wmic/PowerShell 双路径解析与自保护）。
