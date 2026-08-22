# Phase 2：质量与体验加固（2–4 周）

> 目标：把"能打包"提升为"可信赖分发"。E2E 流水线、版本自动化、代码签名、诊断中心、启动性能、i18n。
> 前置：Phase 1 完成；代码签名证书申请已启动（周期 1–2 周）。

## 2.1 E2E 冒烟流水线（5 天）

**现状**：约 50 个单元测试，`scripts/smoke-*.mjs` 有雏形，但缺"构建 → 安装 → 启动 → 加载 Web UI"的端到端验证，打包回归只能靠人肉。

**方案**：新增 `pnpm e2e` 命令，三平台在 GitHub Actions matrix 跑通。

### 步骤

1. **新建 `tests/e2e/` 目录**，脚本 `tests/e2e/vscode.e2e.mjs`：
   - `pnpm pack:vscode` 产出 VSIX
   - 下载 VS Code（`npx @vscode/test-cli` 已内置下载逻辑）
   - `code --install-extension dsh-client-*.vsix --extensions-dir <tmp>`
   - 以 headless 方式启动：`code --extensionDevelopmentPath=apps/vscode`（开发态冒烟）或安装态 + CLI 触发命令 `dsh.start`
   - 断言：扩展日志出现 `loopback url`；HTTP GET 该 URL 返回 200；进程树在退出后被收割（无残留 node）
2. **`tests/e2e/desktop.e2e.mjs`**：
   - `pnpm pack:desktop` 产出安装包（CI 上 Windows 用 zip 产物解压运行更稳）
   - spawn 可执行文件，轮询窗口出现（可用 `get-window-by-title` 或简单监听 stdout 的 ready 日志）
   - 断言托盘启动、引擎进程存在、退出后进程树清空
3. **失败诊断物**：E2E 失败时自动归档 `%APPDATA%\dsh-client-desktop\logs`、ready 文件、截图到 artifact。
4. **CI 接入**（`.github/workflows/e2e.yml`）：

   ```yaml
   on: [push, workflow_dispatch, schedule(weekly)]
   jobs:
     e2e:
       strategy:
         matrix:
           os: [windows-latest, macos-latest, ubuntu-latest]
       runs-on: ${{ matrix.os }}
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v4
         - run: pnpm install --frozen-lockfile
         - run: pnpm fetch:engine stable
         - run: pnpm e2e
         - if: failure()
           uses: actions/upload-artifact@v4
           with: { name: e2e-diag-${{ matrix.os }}, path: tests/e2e/artifacts/ }
   ```

**验收**：三平台 `pnpm e2e` 绿；故意破坏（如 ready 文件不写）时能失败并留下诊断 artifact。

## 2.2 版本管理自动化——changesets（2 天）

**现状**：CHANGELOG 手写，版本靠 "all packages 0.1.0" 约定，易漂移。

**步骤**：

1. `pnpm add -Dw @changesets/cli @changesets/changelog-github && pnpm changeset init`
2. `.changeset/config.json`：`fixed` 组锁住 `@dsh/client-runtime`、`@dsh/plugin-embedded-client`、`@dsh/vscode`、`@dsh/desktop`，保证同升同降；changelog 用 GitHub 格式；access 保持 private 不发布 npm。
3. 开发流程：每次特性 PR 附带 `.changeset/*.md`；合并到 main 后由 CI（Version Packages PR）统一升版本 + 生成 CHANGELOG。
4. `scripts/product-version.mjs` 改为从各包 package.json 读取唯一真源，删除硬编码。

**验收**：创建一个测试 changeset，CI 产出 Version PR，四个包版本与 CHANGELOG 同步更新。

## 2.3 代码签名与发布（3 天）

**现状**：无签名。Windows SmartScreen 直接拦截未签名 exe；macOS 未公证 dmg 无法打开。

### Windows（NSIS + portable）

1. 证书：优先 **Azure Trusted Signing**（按月付费，无需硬件 token）；备选 EV 证书。
2. `electron-builder` 配置：
   ```json
   "win": {
     "sign": "./scripts/sign-windows.mjs",
     "signtoolOptions": { "signingHashAlgorithms": ["sha256"] }
   }
   ```
3. `scripts/sign-windows.mjs` 封装 Azure Trusted Signing API；密钥走 GitHub Secrets（`AZURE_TENANT_ID/CLIENT_ID/CODE_SIGNING_ACCOUNT/CERT_PROFILE`），本地构建无密钥时 warn 而非 fail。
4. CI 仅在打 tag（`v*`）时签名。

### macOS

1. Apple Developer 账号 + "Developer ID Application" 证书导入 keychain（CI 用 secrets base64 注入）。
2. electron-builder afterSign 钩子做 notarize：
   ```js
   // scripts/electron-notarize.cjs（afterSign 钩子内）
   await notarize({ appPath, appleId: process.env.APPLE_ID, appleIdPassword: '@keychain:AC_PASSWORD', teamId: process.env.APPLE_TEAM_ID });
   ```
3. hardenedRuntime + entitlements 至少包含 `allow-jit`（内置 Node 需要）。

**验收**：Windows 签名验证 `signtool verify /pa` 通过；macOS `spctl -a -vv` 显示 accepted；全新机器无警告打开。

## 2.4 诊断中心增强（3 天）

**现状**：desktop 有 diagnostics 导出，但字段有限，缺引擎健康视图。

**方案**：桌面端新增"诊断中心"入口（托盘菜单 + 设置页），功能两层：

1. **健康自检面板**（实时）：
   - 引擎版本（读 `resources/runtime` 下版本文件 / lock）
   - 引擎进程状态（记录的 pid 是否存活）
   - loopback 端口连通性（GET /healthz 或首页）
   - ready 文件最后内容与时间戳
   - 磁盘剩余空间（payload 解压需要）
2. **一键采集**（导出 zip）：
   - 上述健康数据 JSON
   - 主进程与引擎最近 500 行日志（注意脱敏 API Key：导出前对 `sk-*` 模式替换为 `sk-***`）
   - `engine.lock.json`、运行时环境变量快照（仅白名单键）
   - 操作系统 / GPU / Electron 版本

**实现要点**：扩展 `apps/desktop/src/diagnostics.ts`；新增 `health-check.ts`（纯函数便于单测，延续项目测试风格补 `health-check.test.ts`）。

**验收**：健康面板各指标在正常/杀进程/端口占用三种状态下显示正确；导出 zip 无明文密钥。

## 2.5 启动性能优化（5 天）

**现状**：全量打包 550MB+，安装即占大头；download 模式存在但未成为主路径；启动期间用户面对黑盒等待。

**方案分两层**：

### 安装体积（引擎按需下载）

1. desktop 安装包默认只带壳 + 引擎下载器：首启时从 `DSH_RUNTIME_URL`（默认 GitHub Release）下载引擎 zip 到 `~/.dsh-client/runtime/<version>/`，校验 checksum（复用 `scripts/checksum-release.mjs` 逻辑）后解压。
2. 提供"完整离线包"变体给内网用户（`DSH_CLIENTS=offline` 构建场景），两条产品线并存。
3. VSIX 保持 bundled（扩展市场用户预期开箱即用），但用 esbuild metafile 审计并剔除未用依赖，目标 VSIX < 300MB。

### 启动等待可视化

1. `client-runtime` 的 `launchHost` 增加进度事件：`resolving → spawning → waiting-ready → ready`（spawn-host 已有各阶段，补充 EventEmitter 回调）。
2. desktop 启动窗口显示进度条 + 当前阶段文案；VS Code Webview 在 `loadURL` 前渲染本地 loading HTML。
3. 引擎冷启动耗时埋点（本地 JSON 记录，供 2.4 诊断采集），目标 P50 < 5s（不含首次下载）。

**验收**：在线安装包 < 100MB；首启自动下载引擎并显示进度；冷启动有阶段反馈。

## 2.6 中文化 i18n（3 天）

**步骤**：

1. 抽离 `apps/desktop` 全部用户可见文案到 `locales/zh-CN.json`、`locales/en.json`（key 按模块前缀：`tray.*`、`settings.*`、`dialog.*`）。
2. 轻量 i18n 函数（无需引入 i18next）：`t(key, params)`，默认语言取 `app.getLocale()`，设置页可切换并持久化到 `desktop-settings`。
3. 托盘、对话框、设置页、错误提示全覆盖；缺 key 时回退英文并 console.warn。
4. 为后续 JetBrains 端预留同一份 locale 资源（JSON 通用格式）。

**验收**：切换语言后全部壳层文案即时生效；单测覆盖 t() 回退逻辑。

## Phase 2 总验收

- [ ] `pnpm e2e` 三平台绿并接入 CI（含 weekly schedule）
- [ ] changesets 版本流水线生效
- [ ] Windows/macOS 签名 + 公证全通过，全新机器无安全警告
- [ ] 诊断中心上线，导出物脱敏
- [ ] 在线安装包 < 100MB，启动有进度反馈
- [ ] 壳层中英文可切换
