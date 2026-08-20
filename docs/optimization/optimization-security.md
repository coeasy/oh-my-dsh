# P1：安全加固

> 目标：插件安装完整性校验、引擎下载可信度、Electron 安全基线复核。
> 优先级：★★★★☆（分发产品的可信度与合规生死线）。

## C1. 插件 npm integrity 校验（verify.ts）

**现状**：`verify.ts` 仅检查 lifecycle scripts 与 npm squat，安装时未校验包内容完整性。

**方案**：
1. `npm view <pkg>@<ver> dist.integrity` 获取 `sha512-…`。
2. 安装命令 `dsh plugin … add <pkg>` 前，先下载 tarball 计算并比对 integrity；不匹配则拒绝安装并提示。
3. 对 curated 插件，增加发布者（npm `maintainers`）白名单校验。
4. 前端确认弹窗展示校验结果（`secure` / `integrityMismatch` / `publisherUnknown` 三态）。

**验收**：篡改包被拒绝；白名单外发布者提示；校验失败不执行安装。

## C2. 引擎下载签名/校验（engine-updater.ts + download.ts）

**现状**：`engine-updater` 下载引擎未校验签名或 manifest。

**方案**：
1. 发布时为 `harness-<version>-<platform>.tar.gz` 生成 `SHA256SUMS.txt` 与（可选）GPG 签名。
2. 下载后先校验 SHA256（必须），再（可选）验 GPG 签名（`openpgp` 或系统 gpg）。
3. 校验失败不落盘、不回滚运行中版本，并给出明确错误。

**验收**：篡改下载被拒；断网/校验失败时保留当前可用引擎。

## C3. Electron 安全基线复核

**方案**：
1. 复核所有 `BrowserWindow`：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`。
2. `preload.ts` 仅通过 `contextBridge` 暴露白名单 API（核对当前暴露面，收紧）。
3. 确认 `webContents` 不加载远程任意 URL（只允许 loopback）。
4. 复核 `window-open` / `will-navigate` 拦截：仅放行 loopback 与安全的外链（HTTP/HTTPS）。
5. 对 `webServer` 的 mutating 路由，确认仅接受 loopback 且带 CSRF/同源校验（当前注释已声明，需单测锁定）。

**验收**：安全基线核查清单逐项通过；新增单测覆盖 preload 暴露面与导航拦截。

## C4. 依赖漏洞审计

**方案**：
1. CI 引入 `pnpm audit --prod`（或 Dependabot），发现高危依赖自动阻断。
2. 对 Electron / node / harness 的已知 CVE 保持跟踪，在 compatibility 矩阵标注。

**验收**：CI 无高危漏洞告警；README 记录审计命令。

## 落地状态（2026-08-19）

- ✅ **C1**：`verify.ts` 新增 `verifyTarballIntegrity`（下载 tarball 比对 `dist.integrity` sha512，64MB 上限）；`NpmVerifyResult` 增加 `tarball`/`maintainers`/`publisherKnown`/`tarballCheck` 字段；维护者白名单（`TRUSTED_PUBLISHERS`）。安装路由在调用官方 CLI 前**硬校验**：mismatch → 403 拒绝安装。前端确认弹窗三态展示（match=绿 / mismatch=红且禁用安装按钮 / unavailable=中性提示），并显示 lifecycle/squat/publisherUnknown 警告。单测覆盖 match/mismatch/unavailable 全路径。
- ✅ **C2**：`download.ts` 流式下载 + 边下边算 sha256 + 失败删除落盘文件（损坏下载永不激活）；5xx/网络错误重试（默认 2 次退避）；仅允许 https URL。`engine-updater.ts` 清单带 checksum，校验失败不落盘。
- ✅ **C3**：新增 `apps/desktop/tests/preload.test.ts` 源码级锁定：preload 暴露面白名单（恰好 4 个方法）、禁止 `ipcRenderer.on/send/sendSync`、IPC 通道白名单；所有 `webPreferences` 块强制 `contextIsolation/nodeIntegration:false/sandbox/webSecurity` 四标志；每个窗口必须过 `secureWindow()`；导航拦截（window-open/will-navigate/webview/权限处理器）不可移除。
- ✅ **C4**：CI（`.github/workflows/ci.yml`）已含 `pnpm audit --prod --audit-level high` 门禁。
