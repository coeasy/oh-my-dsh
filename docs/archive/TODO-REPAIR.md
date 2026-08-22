# oh-my-dsh 全面修复 TODO

## 目标
1. deepseek-harness 更新到最新 release
2. 修复所有插件界面展示问题
3. 修复所有构建/打包问题
4. 本地构建 + 第三方安装均通过

## 阶段
- [x] S1 更新 deepseek-harness 到 dsh-v0.1.1-rc.2 并梳理差异
- [x] S2 全面梳理项目功能与展示链路
- [x] S3 修复界面展示问题（preload 侧边栏桥接 + online 资源 + 防回归）
- [x] S4 修复构建/打包问题（build-engine 空格路径 + online 资源）
- [x] S5 本地构建验证（install / 测试 530 / compile 全部通过）
- [x] S6 第三方打包验证（bundled 版 zip/Setup/portable 产出，包内资源校验通过）
- [x] S7 启动流程优化（插件安装异步化，主程序先出，插件后台 HMR 热载）
- [x] S8 双版本打包覆盖修复（system 版输出到 dist-release-online，bundled/system 产物共存）
- [x] S10 exe 启动无反应一次性修复：
  - L1 插件安装异步化：插件安装改为后台 fire-and-forget，主程序先出
  - L2 primaryFirstInstall dialog 非阻塞（void + catch），不再阻塞后台 ensureFirstPartyPlugins
  - L3 PATH 注入 runtime 目录（dsh.cmd 裸调用可解析）
  - L4 junction 规整 normalizeEngineJunction（消除 EPERM 竞态）
  - L5 readyTimeoutMs 180s→90s（失败更快反馈）
  - L6 payload 版本一致性校验 + 强制 flatten（stage-payload 重建 0.1.1-rc.2）
  - L7 win-unpacked 被 system 版覆盖修复（DSH_ELECTRON_OUTPUT 分离输出）
  - L8 build/icon.png 缺失警告修复（复制 apps/desktop/icon.png）
- [x] S11 内置插件安装验证：受控启动后 @dsh/plugin-model-config / degeneration-guard / usage-analytics 在 primary+mirror 两个 home 均安装成功（main.log 04:48 记录），引擎 web ready（65108），无 EPERM/dsh.cmd 错误
- [x] S12 白板/显示错乱修复（用户反馈“打开界面白板”）：
  - 根因A：内置插件装上后缺生产依赖 —— usage-analytics 的 out/index.js external 了 sql.js，但 copy-bundled-plugins.mjs 只复制 package.json/cordis.patch.yml/out → 引擎加载插件树 ERR_MODULE_NOT_FOUND → web 服务起不来 → 白板
    - 修复：copy-bundled-plugins.mjs 递归复制生产依赖链到「插件目录下 node_modules」（不能放根 node_modules——electron-builder filter.js 排除第一层 node_modules；放插件子目录才不被排除且 Node 可解析）
  - 根因B：渲染进程死循环 —— preload.ts 的 MutationObserver 监听整个 documentElement 的 childList+class，回调 mount 函数又改 DOM（appendChild/classList.toggle），与 React 侧边栏折叠/HMR 的 mutation 相互触发 → 渲染进程以 ~10 倍速吃满 CPU（实测 3 秒 +30s user time）→ 页面白屏
    - 修复：observer 回调改为 requestAnimationFrame 节流（queueSidebarSync，一帧一次）
  - 验证：正式打包后受控启动 —— 页面 htmlLen 35,765 完整渲染，侧边栏显示 模型配置/退化防护/用量分析 按钮，渲染进程 CPU 正常（4s 涨 ~6s），无 EPERM/dsh.cmd/integrity 错误
- [ ] S9 安装后真机 UI 人工验证（侧边栏按钮/配置窗口/用量条）——需在真实机器确认视觉呈现
- [x] S13 按 docs/ux-improvement-plan.md 一次性实现 P0 系列（真机验证通过）：
  - P0-1 启动不弹浏览器：launchHost 传 `--no-open`（引擎命令实测带 `--no-open`，日志无 opening browser）
  - P0-2 窗口最大化+记忆：desktop-settings `windowBounds` + `usableWindowBounds`（越界回退）+ `watchWindowBounds`（防抖持久化），首次启动最大化
  - P0-3 市场双加载（skeleton 去重，loading 2→1，之前完成）
  - P0-4 市场「已安装」tab：后端 list 支持 `installed_only`（修复 first-party 被 MAX_PER_SOURCE=2000 截断）+ 前端双 tab，实测 4 张已安装卡片、内置插件只读（仅详情）
  - P0-5 退化档位真实差异化：types `MODE_PRESETS` + core.setMode 应用预设 + mount 档位卡片/恢复默认 + 回归测试，实测 strict 参数全变（minCount 3→2、hardStop 12→8、turns 30→20 等）
  - web 端识别内置插件：catalog `FIRST_PARTY_CATALOG_ENTRIES`（dsh-harness/plugin-*）注入 builtin 源 + entryView `firstParty` 字段，实测 3 内置 installed/firstParty/inBundles 全 True
  - 插件改主窗口内嵌面板：独立 BrowserWindow → WebContentsView（showPluginConfigView + 右上角 ✕ 关闭按钮 + resize 跟随 + 单面板切换），实测无独立窗口、面板铺满、切换/关闭正常
  - 滚动条消除：preload 去掉 body 26px padding + FILL_VIEWPORT_CSS `overflow:hidden`（引擎 SPA 内部 scrollBody 滚动不受影响），实测 scrollH==innerH 无滚动条
