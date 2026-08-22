# 构建脚本深度优化 TODO

## 目标
1. harness 自动更新到最新版本
2. 本地一键快速构建安装
3. 跨平台（Windows/macOS/Linux）第三方电脑一键构建客户端

## 阶段
- [x] B1 审查现有构建链路与平台假设
- [x] B2 设计跨平台一键构建方案
- [x] B3 实现 harness 自动更新（scripts/engine-update.mjs + fetch-engine 固化 pinnedCommit）
- [x] B4 实现本地一键构建安装（build-clients 增量开关 + 预检 + 纳入 pnpm install）
- [x] B5 实现跨平台一键构建（三份平台脚本统一为薄包装 + install-clients 跨平台启动）
- [x] B6 验证（engine-update 实跑 / 相关测试 16+ / build-clients 轻量验证 / 语法检查）

## 交付
- scripts/engine-update.mjs（新增）：engine:update / engine:update:stable 一键自动更新 harness
- scripts/engine-lock.mjs：支持读写 pinnedCommit
- scripts/fetch-engine.mjs：fetch 后自动固化 pinnedCommit
- scripts/build-clients.mjs：预检、channel/显式 ref 解析、增量开关（SKIP_PNPM_INSTALL/SKIP_FETCH/SKIP_ENGINE_BUILD）、AUTO_UPDATE_LOCK、纳入 pnpm install、CI frozen-lockfile
- tools/build-clients.{cmd,ps1,sh}：统一薄包装（环境检查+传参）
- scripts/install-clients.mjs：跨平台启动桌面产物（NSIS/open/AppImage）
- tools/README.md：三平台用法文档
