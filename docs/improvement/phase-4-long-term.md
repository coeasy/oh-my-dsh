# Phase 4：长期方向（3 个月+，按资源选做）

> 定位：护城河建设。各方向相互独立，可按团队资源并行或裁剪。

## 4.1 单二进制 / 瘦身分发（15 天）

**目标**：对标 Codex CLI（Rust 单二进制），把桌面安装包 + 引擎的总体积从 550MB+ 压到 <150MB。

**路线评估**：

| 方案 | 说明 | 可行性 |
|---|---|---|
| Bun 编译 | `bun build --compile` 打包引擎 CLI；但上游依赖 Node 22+ 特性与 Cordis 生态，需全量回归 | 中——上游是 Node 生态，Bun 兼容性风险大 |
| Node SEA（Single Executable App） | Node 官方单文件方案；postject 注入 | 中——SEA 对动态 require/ESM 支持有限，需验证 Cordis 插件动态加载 |
| 引擎裁剪 + 高压缩 | 删除克隆内 docs/tests/devdeps、双 aggregate 只留 client、7z/xz 压缩分发 | 高——风险最低，先做 |

**建议执行顺序**：先做"裁剪 + 压缩"（预计 40%+ 缩减，1 周内见效），同时开 SEA PoC 验证 Cordis 动态加载，Bun 仅作调研不投入。

**验收**：安装包（含引擎）< 300MB（第一阶段）；SEA PoC 结论文档化。

## 4.2 企业离线打包方案（20 天）

对齐差距分析报告"企业级能力"项，本项目能落地的部分：

1. **离线安装包**：单 zip 包含 desktop + 引擎 + 预置配置（`DSH_RUNTIME_URL` 指向内网 HTTP 镜像即可自动更新）。
2. **内网镜像规范**：文档化 `DSH_RUNTIME_URL` 目录结构与 checksum 文件格式，企业用 nginx/Artifactory 自建镜像。
3. **策略配置**：支持 `policies.json`（注册表/managed preferences 分发）：锁定 API 基址（企业网关代理）、禁用遥测、禁用手机桥接、预设引擎版本。
4. **审计友好**：诊断导出支持组织级聚合格式（脱敏 JSONL），接入企业 SIEM。

**验收**：示范企业环境（隔离网络）完成安装、更新、策略下发全流程。

## 4.3 插件市场对接（依赖上游，持续）

上游"一切皆插件"但无集中市场（仅 GitHub topic `dsh-plugin`）。客户端侧先做发现入口：

1. desktop 设置页 / VS Code 命令面板新增 "Browse Plugins"：抓取 GitHub topic `dsh-plugin` 列表（名称、描述、star、更新时间）。
2. 一键安装：下载到引擎插件目录并生成 `--patch` overlay（复用 `buildPatchYaml` 机制），重启生效。
3. 上游 registry 出现后切换数据源，UI 不变。

**风险**：上游插件加载协议破坏性变更 → 受 `docs/compatibility.md` 矩阵保护。

## 4.4 遥测 Opt-in（8 天）

1. 默认关闭，首启向导中显式询问（遵守"默认不采集"）。
2. 指标（匿名、无用户内容）：启动各阶段耗时、引擎版本、崩溃事件（exit code 非 0）、更新成败。自建最小采集端点（一个 Cloudflare Worker + KV 即可）或接 Umami/PostHog 自托管。
3. 数据回流驱动 2.5 性能目标迭代；诊断中心显示"遥测状态"并可随时关闭。

## 4.5 差距分析对齐清单（与竞品报告联动）

持续跟踪 `docs/competitive-analysis/deepseek-harness-差距分析与战略补足建议书-2026-08-14.md` 中与客户端仓库相关的项：

| 报告项 | 本仓库承接 | 状态 |
|---|---|---|
| 上手门槛（#3） | 首启向导（3.5）+ 示例模板 | Phase 3 |
| IDE 集成（#2） | VS Code/Cursor（已有）+ JetBrains（3.1） | Phase 3 |
| 分发形态（#6） | 一键构建（已有）+ 瘦身（4.1）+ 双市场（3.2） | 持续 |
| 企业能力（#5） | 企业离线包（4.2） | Phase 4 |
| 插件市场（#8） | 客户端发现入口（4.3） | 依赖上游 |

## 跨阶段风险登记表

| 风险 | 影响 | 缓解 |
|---|---|---|
| 上游破坏性变更 | Phase 2–4 多项受牵连 | engine.lock 基线 + weekly 冒烟 + 兼容矩阵 |
| 签名证书延迟 | 2.3 阻塞 | Phase 1 期间即启动申请 |
| JetBrains JCEF 不支持 loopback | 3.1 返工 | 强制 2 周 PoC 门槛，B 方案兜底 |
| 手机桥接安全漏洞 | 严重声誉风险 | token 一次性 + TLS 指纹 + 默认关闭 + 攻击用例测试 |
| 550MB 产物失控 | 仓库/CI 膨胀 | hygiene 规则 + 产物全 gitignore |
