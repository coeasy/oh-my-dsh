# oh-my-dsh 项目梳理与工业级差距分析

> 编制：2026-08-18
> 范围：全仓库（apps/desktop、apps/vscode、packages/client-runtime、plugins/embedded-client、scripts、docs）

---

## 一、项目定位与功能梳理

**oh-my-dsh** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**非官方客户端封装**（VS Code / Cursor 扩展 + Electron 桌面端）。它**不 fork 内核**、**不存储内核源码**，只做"外壳"：负责把上游 `dsh web` 拉起来，并加载其 loopback URL。

### 架构分层

```
apps/vscode ──┐
              ├── @dsh/client-runtime ──spawn──►  dsh web + embedded-client patch
apps/desktop ─┘                                          │
                                                         ▼
                                          http://127.0.0.1:<port>
                                                         │
                                                 上游 Web SPA
```

依赖方向单向、禁止反向，`client-runtime` 通过运行时生成 `--patch` overlay 注入插件，无循环依赖。

### 核心模块与能力

| 模块 | 路径 | 职责 |
|---|---|---|
| **Embedded Client 插件** | `plugins/embedded-client` | Cordis 补丁：锁定 `127.0.0.1:0` + 写入 ready 文件 |
| **Client Runtime** | `packages/client-runtime` | 解析 dsh / 下载 / spawn / ready / 健康检查 / shutdown 全生命周期 |
| **VS Code / Cursor 扩展** | `apps/vscode` | Webview 加载 loopback URL；`dsh.open` / `dsh.stop` 命令 |
| **Electron 桌面端** | `apps/desktop` | 托盘、工作区选择、首启 API Key 设置、诊断导出、引擎更新、LAN 手机桥接 |
| **构建脚本集** | `scripts/` | 一键打包、引擎获取/拉平/搬迁、签名、校验、hygiene、冒烟 |

### 关键工程特性（已实现）

- **一键构建分发**：`build-clients.cmd` / `.ps1` / `.sh`，Windows→NSIS/portable/zip，macOS→dmg，Linux→AppImage
- **可搬迁运行时**：打包 `dsh.cmd` 只用 `%~dp0` 相对路径，直接 `node + bin.js` 启动，无 `cmd.exe` 控制台残留
- **引擎获取链路**：GitHub stable → latest release → `git ls-remote --heads` → `engine.lock.json` 兜底
- **进程生命周期管理**：Windows `taskkill /T /F` 收割整棵进程树；POSIX stdin EOF → SIGTERM → SIGKILL
- **安全基线**：`assertLoopbackUrl` 只接受 `http://127.0.0.1:<port>`，拒绝 localhost/0.0.0.0/::1/https
- **桌面端**：系统托盘、隐藏原生标题栏（titleBarStyle:hidden）、首启向导、诊断导出、更新检查、LAN 手机桥（默认关闭）
- **质量基线**：`pnpm verify`（hygiene + 156 测试 + audit:layers + compile）
- **i18n**：手机桥接页双语；SPA 返回 zh-CN

---

## 二、工业级差距与改进点

按影响和优先级排序（⚠️ 为文档声称已完成但**实际缺失**，是本报告最重要的发现）。

### 关键发现：文档与代码不一致

`docs/improvement/README.md` 声称以下已"落地/已实现/已确认完成"，但**仓库内不存在对应文件**：

| 文档声称 | 实际状态 | 证据 |
|---|---|---|
| Phase 2.1 "e2e.yml 三平台 CI 已落地" | 已补齐 | `.github/workflows/ci.yml` + release.yml（本轮新建） |
| Phase 2.2 "changesets + version.yml 已落地" | 已补齐 | `.changeset/config.json` fixed 组（本轮新建） |
| Phase 2.6 "全量中文化确认已完成" | **仍未落地** | splash/setup.html 为 `lang="en"` 纯英文，无 locale 资源与切换机制；需后续抽离 locales |
| Phase 2.4 诊断健康自检 | ✅ 有 `health-check.ts` | 与文档一致 |
| Phase 3.2 引擎自动更新 | ✅ 有 `engine-updater.ts` | 端到端激活待发布基建 |
| Phase 3.3 手机桥接 | ✅ 有 `lan-mobile-bridge.ts` | 与文档一致 |

**结论**：发布前必须要么补上缺失的 CI / changesets，要么修正 `docs/improvement/README.md` 中的完成状态，否则公开仓库会自相矛盾。

### 工业级差距清单

#### A. 阻断发布可信度的硬缺口

1. **无 CI 流水线（最高优先级）**——无 `.github/workflows/`。工业级项目必须有三平台 `verify` / `test` / `compile` 门禁 + 打包回归。文档已写明方案（`e2e.yml` 矩阵），直接落地即可。
2. **无代码签名**——Windows SmartScreen 直接拦截未签名 exe；macOS 未公证 dmg 无法打开。需外部证书：Windows EV / Azure Trusted Signing、Apple Developer ID。**外部依赖，需尽早启动申请**。
3. **无版本自动化**——无 `.changeset/`，版本靠 "all 0.1.0" 手工约定，易漂移。建议落地 changesets fixed 组同升同降。

#### B. 体验与可靠性缺口

4. **E2E 只有骨架**——`tests/e2e/vscode.e2e.mjs` 只验证产物存在，未真正启动 VS Code 断言 loopback 可达、进程树清空。需补真实 headless 启动（`@vscode/test-cli`）+ desktop.e2e。
5. **安装体积过大（550MB+）**——默认整包携带引擎 payload。缺"在线安装包"形态（壳 + 下载器，首启拉引擎到 `~/.dsh-client/runtime/<ver>/`），启动等待无进度反馈。
6. **启动可视化缺失**——`launchHost` 无阶段进度事件（resolving→spawning→waiting-ready→ready），用户面对黑盒等待。
7. **i18n 未落地**——壳层（托盘/对话框/设置页）仍为硬编码英文。需抽 `locales/zh-CN.json` / `en.json` + 轻量 `t()` 函数。

#### C. 功能扩展（Phase 3，按资源排期）

8. **引擎自动更新端到端**——`engine-updater.ts` 已实现下载/校验/激活/回滚，但"检测→提示→平滑重启"主链路与发布基建未接通。
9. **JetBrains 支持**——无对应入口；JCEF 对 loopback 兼容性是已知风险，需 PoC。
10. **LAN 手机桥安全加固**——配对 token 一次性 + TLS 指纹 + 默认关闭的策略与攻击用例测试需补全。
11. **多会话并行 / 崩溃恢复 / 最近工作区**——托盘按工作区分子菜单、残留引擎恢复等未实现。
12. **首启向导三步化 + 示例模板**——降低上手门槛。

#### D. 长期（Phase 4）

13. **瘦身分发**（裁剪 + 压缩 / Node SEA / Bun 调研），目标 <150MB
14. **企业离线包 + 内网镜像 + policies.json 策略下发**
15. **插件市场发现入口**
16. **遥测 Opt-in**

---

## 三、达到"工业级"的落地路径（ROI 排序）

| 优先级 | 事项 | 依赖 | 工时 |
|---|---|---|---|
| ★★★★★ | 落地 `.github/workflows/verify.yml` + `e2e.yml` 三平台矩阵 | 无 | 1–2 天 |
| ★★★★★ | 落地 `.changeset/` fixed 组版本自动化 | 无 | 0.5 天 |
| ★★★★★ | 修正 `docs/improvement/README.md` 完成状态，消除自相矛盾 | 无 | 0.5 天 |
| ★★★★★ | 补 E2E 真实 headless 启动断言（VS Code + desktop） | CI | 3–5 天 |
| ★★★★ | 代码签名（Windows EV / Apple） | 外部证书 | 阻塞项，立即申请 |
| ★★★★ | 在线安装包 + 启动进度事件 | — | 5 天 |
| ★★★ | i18n 抽离（托盘/对话框/设置） | — | 3 天 |
| ★★★ | 引擎自动更新端到端接通 | 发布基建 | 视排期 |
| ★★ | JetBrains / 多会话 / 首启向导 | — | 视排期 |

**先做 A 组三件（CI + changesets + 文档修正）即可显著提升可信度，且无需外部资源；签名与真实 E2E 是分发前的第二道生死线。**

---

## 四、已执行的仓库整理

**本轮已补齐的工业级基础设施**（commit 2）：
- `.github/workflows/ci.yml`（三平台 verify + pack 冒烟）、`.github/workflows/release.yml`（tag 触发，三平台打包 + GitHub Release）
- `.github/CODEOWNERS`、`.github/dependabot.yml`、`.github/pull_request_template.md`、`.github/ISSUE_TEMPLATE/{bug,feature,config}.yml`
- `.changeset/`（config.json + README，fixed 组锁同升同降）
- 各包 `package.json` 补 `repository` 字段；vscode 移除 `--allow-missing-repository`
- 修正 `docs/improvement/README.md` 完成状态，如实标注 i18n 未完成

**已排除的本地残留**（写入 `.gitignore`，不进入版本库）：
  - `scripts/_cleanup_stage.py`、`scripts/_del_pnpm.sh`（含硬编码 `D:\workspace\oh-my-dsh` 路径的开发清理脚本）
  - `.rundata/`、`output/`（空运行时目录）
- **保留**：全部源码、测试、文档、LICENSE、CI 所需配置、`docs/improvement`（路线图，后续需修正完成状态）

> 注：`deepseek-harness/`、`runtime/`、构建产物、`.env` 已由 `.gitignore` 覆盖，不会误提交。
