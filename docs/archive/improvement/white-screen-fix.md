# 白屏根因与深度修复（2026-08-18）

## 现象

桌面客户端 / VS Code 启动后界面白屏：启动 splash 后窗口加载 loopback URL 但一片空白，无任何错误提示。

## 根因定位过程

1. **排除壳层问题**：检查 `openHarness → loadURL(url)`、`secureWindow`、`window-navigation`、CSP、`FILL_VIEWPORT_CSS`，均正常。
2. **在引擎层复现**：直接用打包的 `runtime/payload/dsh.cmd web` 启动，捕获到崩溃日志：
   ```
   Error: failed to import loader entry settings (@deepseek-ai/dsh-settings-file):
   Cannot find package 'readdirp' imported from ...\chokidar\esm\index.js
   ```
3. **继续修复一个暴露下一个**：补上 `readdirp` 后又暴露：
   ```
   Error: Cannot find the native Koffi module; did you bundle it correctly?
   ```
4. **对比源克隆**：`deepseek-harness` 克隆自身 `dsh web` 返回 **HTTP 200 正常**；而 flatten 后的 payload 崩溃。

## 根因

`runtime/payload` 由 `scripts/stage-payload.mjs` → `scripts/flatten-harness.mjs` 从克隆打平生成。flatten 的依赖收集 `collectFromNodeModules` 里 `if (entry.startsWith('.')) continue` **跳过了 pnpm 虚拟商店 `node_modules/.pnpm/`**，导致两类包被丢弃：

- **传递 JS 依赖**：如 `readdirp`（chokidar@4 的依赖），只存在于 `.pnpm/readdirp@4.1.2`，未被任何被遍历的真实嵌套目录链接到 → 丢失 → settings 插件崩溃。
- **原生平台二进制包**：如 `@koromix/koffi-win32-x64`、`@img/sharp-win32-x64`、`@oxc-parser/binding-win32-x64-msvc`、`@rollup/rollup-win32-x64-msvc` 等（可选依赖，不链接进引用方 node_modules）→ 丢失 → 原生 FFI 崩溃。

任一缺失都会使 `dsh web` 在启动阶段崩溃 → loopback 无服务 → 白屏。

## 修复

`scripts/flatten-harness.mjs` 增加对 `.pnpm` 虚拟商店的遍历 `collectFromPnpmStore`：

- 收集 `.pnpm/<name>@<version>/node_modules/<pkg>` 下所有真实包（含作用域包 `@scope/pkg`）；
- **只保留宿主平台的原生包**（`PLATFORM_TAG_RE` 匹配 `darwin/win32/linux/...-x64/arm64/...`，非当前 `process.platform-arch` 的跳过），既补全原生模块又控制体积；
- 用 `addPackage` 的首胜机制保证主树已正确选择的版本不被 `.pnpm` 覆盖（`.pnpm` 仅填空缺）。

重建后 `runtime/payload` 补齐：`readdirp@4.1.2` 及全部宿主原生 `.node`（koffi、sharp、oxc-parser/resolver、oxlint、rolldown、rollup、lightningcss、node-addon-require-builtin）。

## 验证

- 重建后 `runtime/payload/dsh.cmd web` 返回 **HTTP 200** 且完整 SPA（`lang="zh-CN"`，含 `__DSH_BOOT__`）。
- `flattenHarness` 单元测试通过。
- 桌面全量测试 86/87 通过（唯一失败为 robocopy 环境的既有用例，与本次无关）。

## 经验沉淀

- 打平 pnpm 工程为 link-free 目录时，**必须遍历 `.pnpm` 虚拟商店**，否则会丢传递依赖与原生二进制包。
- 原生可选依赖（koffi/sharp/oxc 等平台包）不链接进引用方 node_modules，flatten 逐嵌套目录的收集方式天然漏掉它们。
- 修一个漏包暴露下一个，说明此类打包缺失具有系统性，应一次性从 `.pnpm` 全量补齐并按宿主平台过滤，而非逐个打补丁。
