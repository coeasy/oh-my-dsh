# my-dsh 桌面客户端 UX 深度优化方案

> 生成日期：2026-08-22（v2，增补：市场“已安装”tab、退化档位、视觉美化）
> 范围：窗口与全屏、插件界面展示、交互体验、启动行为、插件市场信息架构
> 依据：本机实测（1920×1080 屏幕）+ 源码走查

---

## 一、问题诊断（附证据）

### 1.1 窗口不全屏，内容展示不完整 【P0】

**现象**：客户端启动后窗口固定 1380×900，在 1920×1080 屏幕上只占屏幕约 72%×83%，不能最大化记忆，内容挤压。

**根因**（`apps/desktop/src/main.ts` `createWindow()`）：

```ts
window = new BrowserWindow({
  width: 1380,
  height: 900,
  minWidth: 900,
  minHeight: 640,
  show: false,
  ...
})
```

- 写死 1380×900，**没有任何 `maximize()`、状态持久化或按屏幕工作区计算尺寸的逻辑**
- 实测：`window.innerWidth=1380, innerHeight=900`，而 `screen.width=1920, screen.availHeight=1040`
- 关闭重开后窗口位置/大小不记忆，每次都是默认值、默认居中偏左上

### 1.2 启动默认打开系统浏览器 【P0】

**现象**：启动客户端后，引擎 `dsh web` 会额外唤起默认浏览器打开同一页面，造成双开、体验割裂。

**根因**（`packages/client-runtime/src/spawn-args.ts`）：

```ts
export function buildWebArgs(patchPath: string, extraArgs: string[] = []): string[] {
  return ['web', '--patch', patchPath, '--host', '127.0.0.1', '--port', '0', ...extraArgs]
}
```

- 未传 `--no-open`；`spawn-host.ts:153` 支持 `options.extraArgs` 透传，但 `main.ts` 调用 `launchHost()` 时**没有传**
- 引擎日志可见 `dsh web: opening the default browser; pass --no-open to disable`

### 1.3 插件界面展示效果差 【P1】

**现象**：模型配置 / 退化防护 / 用量分析三个内置插件是**独立弹窗**，与主窗口割裂；插件市场是主窗口内的面板，两种形态并存。

**根因**（`apps/desktop/src/main.ts` `PLUGIN_CONFIG_PAGES` + `showPluginConfigWindow()`）：

| 插件 | 形态 | 窗口尺寸 | 问题 |
|------|------|---------|------|
| 模型配置 | 独立 BrowserWindow | 900×680 | 位置不记忆、不跟随主窗口 |
| 退化防护 | 独立 BrowserWindow | 760×620 | 同上 |
| 用量分析 | 独立 BrowserWindow | 1080×720 | 同上 |
| 插件市场 | 主窗口内面板 | — | 相对一致，但加载/安装状态有瑕疵 |

- 三个插件窗口 `backgroundColor: '#0f1115'` **写死深色**，不跟随系统明暗主题
- 窗口 `minWidth: 560, minHeight: 420` 偏小，内容在大屏上留白多、小屏上溢出
- 独立窗口与主窗口之间无视觉连续性（切换靠任务栏），用户感知为"好几个零散小程序"

### 1.4 交互体验差 【P1】

- **插件市场双重确认**：点击"安装"→ 面板内 DOM confirm 弹窗 → 再弹**原生系统对话框**（`confirmMarketAction` 用 `dialog.showMessageBox`）→ 点"继续"才真正安装。两层确认冗余，且原生框挂起时面板显示"安装中…"，用户以为卡死。
- **加载文案重复**：市场面板启动时顶部进度条与列表骨架**同时**显示"正在加载插件目录"（`src/client/index.ts` 两处渲染同一 `progress`）——**本次已修复**（骨架区去掉重复文案，实测 loading 从 2 处降为 1 处）。
- **安装进度黑盒**：安装大插件（如 169 个依赖）耗时 60s+，面板只显示"安装中…"，无进度、无预估、无取消。
- **窗口行为不可配置**：无"启动最大化""启动不打开浏览器"等偏好设置项。

### 1.5 插件市场缺少“已安装”视图 【P0，新增】

**现象**：用户装了插件后，无法集中查看/管理已装集合，只能靠卡片上小徽章、排序置顶、或藏在「⋯」诊断面板里的纯文本列表。

**现状**（`plugins/plugin-marketplace/src/client/index.ts`）：
- 工具区只有 6 个数据源 chips + 13 个分类 chips（共 19 个平铺两行），没有“已安装”筛选入口
- `r.installed` 数据已存在，i18n 词条 `installed: '已安装'` 已存在，卡片已有 update/remove 按钮
- 已装列表只出现在 `doDiagnose()` 的纯文本输出（`⋯` → 诊断）

**结论**：数据层、词条、卡片操作全就绪，只缺一个筛选 tab，成本极低、收益直接。

### 1.6 退化防护档位形同虚设 【P0 功能缺陷，新增】

**现象**：用户发现“不同档位配置参数基本一样”——**完全属实，且比感知更严重**。

**根因**（`plugins/degeneration-guard/src/core.ts:76`）：

```ts
setMode(mode: GuardMode): void {
  this.cfg = { ...this.cfg, mode }   // 只改 mode 字符串！
  if (mode === 'off') this.resetAll()
}
```

- 切换 standard/strict **只改 `cfg.mode` 字段，所有检测参数不变**（`DEFAULT_CONFIG` 仅一套，无 per-mode 预设）
- `strict` 在整个代码库中除类型定义外无任何独立行为——**standard 与 strict 实际完全等价**
- UI 的“检测参数”表格如实反映了这个缺陷（无论选哪个档位，参数一模一样）
- 唯一有真实差异的是 `off`（`isEnabled()` 返回 false）

### 1.7 界面视觉观感 【P1，新增】

**市场面板**：
- 双排 chips 平铺（19 个）无视觉层级，源选择与分类筛选混在一起
- 卡片字号 13px/12px 偏小，双列 330px 紧凑网格信息密度高但主次弱
- 已装徽章、精选徽章、类型徽章、未激活警告全堆在标题行，拥挤
- 输出/诊断区是纯 `<pre>` 文本，与整体风格脱节

**插件窗口**（`apps/desktop/src/plugins/degeneration-guard-ui-page.ts` 等）：
- 写死深色背景 `#0f1115`，不跟随系统明暗（浅色系统下突兀）
- 原生 `<select>`/`<table>` 无设计语言，与主应用（dsw design tokens）割裂
- 状态条是一行小字（`模式：standard · 检测 0 · 命中 0 · ...`），关键状态不突出

### 1.8 已修复项（本次会话）

- 插件市场"两个正在加载目录"：`plugins/plugin-marketplace/src/client/index.ts` 骨架区去掉重复进度文案，已构建并同步到运行副本，实测生效。

---

## 二、优化方案（按优先级分期）

### 阶段 P0：一行级修复，立竿见影

#### P0-1 启动不再打开默认浏览器

**改动**：`apps/desktop/src/main.ts` 调用 `launchHost()` 处（约 644 行）增加 `extraArgs`：

```ts
rememberEngine(
  await launchHost({
    ...
    extraArgs: ['--no-open'],   // 新增：桌面端自带窗口，禁止引擎再开浏览器
  }),
)
```

- `LaunchHostOptions.extraArgs?: string[]` 已存在（`packages/client-runtime/src/types.ts:20`），无需改 runtime
- 影响面：仅桌面端；VS Code 扩展 / 命令行 `dsh web` 行为不变
- 验证：启动后任务栏无浏览器窗口，仅 my-dsh 主窗口

#### P0-2 窗口最大化启动 + 记忆尺寸位置

**改动**：`apps/desktop/src/main.ts` + `apps/desktop/src/desktop-settings.ts`

1. `DesktopSettings` 增加 `windowBounds?: { x, y, width, height, maximized }`
2. `createWindow()` 启动时：
   - 有已存 bounds 且在当前显示器工作区内 → 恢复；`maximized` 为 true 则 `window.maximize()`
   - 无记录（首次启动）→ **直接最大化**（`window.maximize()`），或至少 `工作区宽×高 × 0.92` 并居中
3. 监听 `resize`/`move`/`maximize`/`unmaximize`（debounce 300ms）写回 `desktop-settings.json`
4. 跨显示器安全：恢复前用 `screen.getDisplayMatching(bounds)` 校验，越界则回退默认最大化

**验收**：
- 首次启动即最大化；手动缩小后重启保持该尺寸位置
- 拔掉外接显示器再启动不出现窗口跑出屏幕

#### P0-3 市场双加载文案（已完成，待随版打包）

- 已改 `src/client/index.ts`，已构建 client.js 并同步三处运行副本
- 待办：随下次正式打包进 `dist-release`，补一条 `verify.test.ts` 级别的快照断言（可选）

### 阶段 P0+：市场“已安装” tab + 退化档位（新增）

#### P0-4 插件市场“已安装” tab

**改动**：`plugins/plugin-marketplace/src/client/index.ts`

1. 状态新增 `const [mine, setMine] = useState(false)`
2. 工具栏搜索框右侧加一组双 tab：「全部 / 已安装」（复用 `S.chip`/`S.chipOn` 样式，或做成分段控件）
3. 过滤逻辑（`sorted` 计算）追加：
   ```ts
   if (mine && !r.installed) return false
   ```
4. 「已安装」视图下额外收益：隐藏“安装”按钮，突出「更新 / 移除 / 停用」，并可显示安装时间（若 API 提供）
5. 分类 chips 在「已安装」视图内仍然可用（组合筛选）

**后端**：无需改动——`api/list` 已返回 `installed` 字段。

**验收**：安装 2 个插件后切到「已安装」 tab，只显示这 2 个卡片，带移除/更新按钮。

#### P0-5 退化防护档位真实差异化

**这是功能缺陷修复，不是纯 UI**。分两步：

**第一步：定义 per-mode 预设**（`plugins/degeneration-guard/src/types.ts` + `core.ts`）：

```ts
export const MODE_PRESETS: Record<Exclude<GuardMode, 'off'>, GuardConfigPatch> = {
  standard: { /* 当前 DEFAULT_CONFIG */ },
  strict: {
    autoRetry: true,
    stream: {
      minPatternSize: 16,        // 更短的模式即判定重复
      minCount: 2,               // 连续 2 次即命中（原 3）
      maxThinkingChars: 32768,   // 思考段上限减半
      maxResponseChars: 131072,
      windowChars: 16384,
    },
    tool: { hardStop: 8 },       // 工具硬停止更敏感（原 12）
    maxTurnsPerSession: 20,      // 轮次提醒更早（原 30）
  },
}
```

**第二步：`setMode()` 应用预设**（`core.ts`）：

```ts
setMode(mode: GuardMode): void {
  const preset = mode === 'off' ? null : MODE_PRESETS[mode]
  if (preset) this.updateConfig({ ...preset, mode })  // 复用已有的重建逻辑
  else this.cfg = { ...this.cfg, mode }
  if (mode === 'off') this.resetAll()
}
```

注意：若用户手动调过参数再切档位，预设会覆盖——建议切档位时弹提示“档位预设将覆盖自定义参数”。

**UI 配套**（`ui-src/mount.ts`）：
1. 档位选择改为三个带描述的选项卡片（而不是裸 `<select>`）：
   - 「标准 · 平衡误报与检出，适合日常」
   - 「严格 · 更短阈值、更早拦截、更易误报」
   - 「关闭 · 完全停止检测」
2. 检测参数表在切换档位时展示新预设，让用户直观看到差异（当前 UI 其实如实展示了缺陷——参数没变是因为后端没变）
3. 补「恢复默认」按钮

**验收**：切 strict 后 `getConfig()` 返回的 minCount 等参数与 standard 不同；UI 表格实时反映。

### 阶段 P1：布局与主题统一

#### P1-1 插件配置窗口体验统一

**改动**：`apps/desktop/src/main.ts` `showPluginConfigWindow()`

1. **主题跟随**：`backgroundColor` 改为 `nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f8f8f6'`，并监听 `nativeTheme.updated` 对已开窗口 `setBackgroundColor`
2. **尺寸记忆**：每个插件窗口的 bounds 持久化到 `desktop-settings.json`（键 `pluginWindows: Record<string, bounds>`）
3. **合理的默认尺寸**：按工作区计算 `min(1080, workArea.width*0.7) × min(720, workArea.height*0.8)`，`minWidth/minHeight` 提升到 720×520
4. **定位**：首次打开相对主窗口居中偏移（cascade +32px），避免完全遮挡主窗口

#### P1-2 安装确认流程收敛

**改动**：`apps/desktop/src/market-broker.ts` + `src/main.ts`

- 方案 A（推荐，低风险）：保留原生确认框（安全底线），**去掉市场面板内的 DOM confirm 弹窗**，只留一层；原生框文案补充安全提示（发布者/生命周期脚本）。
- 方案 B（体验更好，中风险）：`install`/`update` 类改用面板内富 confirm（展示 verify 结果、squat 警告、lifecycle 提示），仅 `remove`/`uninstall-*` 保留原生框。需要面板 confirm 能拿到 `api/verify` 结果（接口已存在）。
- 无论 A/B：原生框出现时面板文案从"安装中…"改为"等待确认…"，消除"卡死"错觉（`src/client/index.ts` `act()` 的 `stageVerifying` 文案细分）。

#### P1-3 安装进度可视化

- `api/install` 为长任务：broker 层增加**轮询/进度事件**（或至少面板每 5s 轮询 `api/status` 展示"正在解析依赖/下载 xx/yy"）
- 面板按钮支持"取消"（abort 官方 CLI 子进程，`install.ts` 已有 `ChildProcess` 句柄可复用）
- 超过 20s 的安装显示提示："大型插件安装可能需要 1-2 分钟"

### 阶段 P1.5：视觉美化（新增）

#### P1-4 市场面板信息架构重组

**目标**：从「19 个 chips 平铺」变为「清晰的导航层级」。

1. **顶部主 tab**（替代 source+category 两排 chips）：
   - `全部 | 已安装 | 精选`（三个主视图，对应 P0-4）
2. **数据源选择收进下拉**：搜索框旁一个 `<select>`（全部源 / Awesome / 1024 Store / 社区 / DSH Find / GitHub / 内置）——源是高级筛选，不该占一整行
3. **分类 chips 保留**但收进可折叠区（默认展开，记住状态），或做成左侧竖栏（宽屏时）
4. **卡片视觉升级**：
   - 字号 13→14px（标题）/ 12→13px（描述）；行高放宽
   - 徽章简化：已装用左侧绿色竖条+“已安装”角标，精选改⭐图标，类型徽章弱化为灰色小字
   - hover 态：卡片边框变 accent 色 + 轻微上浮（transform: translateY(-1px)）
   - 图标库引入（lucide-react 或内联 SVG）：更新⟳、移除🗑、详情ℹ
5. **空状态设计**：搜索无结果/已装为空时显示插画+引导文案（“还没有安装任何插件，去全部里逛逛”）
6. **输出区改为可折叠卡片**：安装日志用 monospace + 语法高亮关键行（✓/✗/WARN）

#### P1-5 插件窗口视觉升级（degeneration-guard / model-config / usage-analytics）

1. **主题统一**（与 P1-1 联动）：CSS 变量接入 dsw token，跟随系统明暗；删掉写死的 `#0f1115`
2. **退化防护状态区重构**：
   - 当前：一行小字 `模式：standard · 检测 0 · 命中 0 · ...`
   - 改为：大号档位指示器（标准/严格/关闭三色徽章）+ 指标卡片网格（检测/命中/重试/暂停四张卡，大数字）
3. **参数表升级**：分组展示（流式检测 / 工具链 / 会话限制三组），每行参数加悬停说明（这个参数控制什么）
4. **统一设计语言**：三张插件页面共用一套基础样式（`apps/desktop/src/plugins/` 下抽公共 `plugin-page.css`）

#### P1-6 更多交互细节（综合清单）

1. **市场搜索防抖已有**（250ms），补搜索历史/热门搜索词
2. **卡片图片/图标占位**：很多插件无图标，加 letter-avatar（首字母+品牌色 hash）
3. **键盘导航**：↑↓ 切卡片、Enter 打开详情、/ 聚焦搜索
4. **安装完成 toast**：右上角轻提示“✓ voyager 安装成功”，3s 自动消失（替代现在只在输出区刷日志）
5. **加载骨架屏细化**：卡片级骨架（当前已有 3 张）→ 加载完成后淡入动画
6. **长描述截断**：卡片描述目前 CSS 截断，补 title 提示已有——改为 2 行末尾
7. **国际化检查**：部分硬编码中文（如「安装与移除均走官方 dsh plugin 命令」在英文 locale 下的显示）

### 阶段 P2：一致性与偏好

#### P2-1 设置面板集中管理窗口行为

`设置` 页新增"窗口与启动"分组：
- 启动时最大化（开/关，默认开）
- 记住窗口位置（开/关，默认开）
- 启动时打开浏览器（默认关，对应 P0-1 的 `--no-open`，保留高级用户开关）
- 主题跟随系统 / 强制深色 / 强制浅色

落点：`desktop-settings.ts` 扩字段 + `desktop-settings.ts` 已有读写管道。

#### P2-2 splash 与首启引导打磨

- `splash.html` 已有渐变 + wordmark，补：引擎启动各阶段进度点（启动引擎 → 加载插件 → 就绪），文案用 `launchStageMessage` 现有多语言
- 首次启动引导（setup.html）与主窗口视觉统一字号/圆角/按钮样式

### 阶段 P3：长期（架构级，需单独立项）

#### P3-1 插件面板化（替代独立窗口）

- 将模型配置/退化防护/用量分析从独立 BrowserWindow 迁移为主窗口内**抽屉/路由视图**，与插件市场形态统一
- 收益：单一窗口心智、状态共享（如用量数据直接进会话侧栏）、主题天然一致
- 成本：涉及引擎 SPA 插槽与 `plugin-ui` 注入机制，需评估 `dsh-client-ui-slots` 承载能力；建议先做用量分析（数据型、无副作用）试点

#### P3-2 窗口性能与观感

- 主窗口 `did-finish-load` 注入的 `FILL_VIEWPORT_CSS` 基础上，补 `overflow` 与滚动条样式统一
- 高 DPI/多显示器缩放适配验证（当前 `devicePixelRatio=1` 环境未覆盖 125%/150% 缩放）
- 标题栏 `titleBarOverlay` 36px 拖拽区与 SPA 顶栏对齐微调

---

## 三、实施顺序与工作量估计

| 项 | 内容 | 改动文件 | 量级 | 风险 |
|----|------|---------|------|------|
| P0-1 | 禁止默认开浏览器 | main.ts | 1 行 | 极低 |
| P0-2 | 窗口最大化+记忆 | main.ts, desktop-settings.ts | ~80 行 | 低 |
| P0-3 | 双加载修复入包 | （已完成）打包即可 | 0 | — |
| P0-4 | 市场「已安装」tab | market client/index.ts | ~40 行 | 低 |
| P0-5 | 退化档位差异化（预设+UI） | guard core/types/ui-src + 测试 | ~120 行 | 中（行为变更，需补测试） |
| P1-1 | 插件窗口主题/记忆/尺寸 | main.ts | ~60 行 | 低 |
| P1-2 | 确认流程收敛 | market-broker.ts, client/index.ts | ~40 行 | 中（安全交互，需回归） |
| P1-3 | 安装进度/取消 | market-broker.ts, client/index.ts | ~100 行 | 中 |
| P1-4 | 市场信息架构重组+卡片美化 | market client/index.ts | ~200 行 | 低（纯展示层） |
| P1-5 | 三插件窗口视觉升级 | plugins/*/ui-src + page.ts | ~150 行 | 低 |
| P1-6 | 交互细节清单 | 各处 | ~100 行 | 低 |
| P2-1 | 窗口行为设置项 | desktop-settings 管道 + 设置 UI | ~80 行 | 低 |
| P2-2 | splash 进度打磨 | splash.html, main.ts | ~40 行 | 低 |
| P3-1 | 插件面板化 | 架构级 | 大 | 高（单独立项） |

建议执行顺序：**P0-1 → P0-2 → P0-4 → 打包验证 → P0-5（档位含测试）→ P1-1 → P1-2/P1-3 → P1-4/P1-5/P1-6 → P2**。
P0 五项合计约 240 行代码；其中 P0-1/P0-2/P0-4 一次提交完成，P0-5 涉及检测行为变更单独提交并补全单元测试。

## 四、验证方法（沿用本次会话的验证链路）

1. **窗口**：启动后 CDP 读取 `window.innerWidth/innerHeight` 对比 `screen.availWidth/availHeight`，断言最大化；缩放窗口→重启→断言恢复
2. **浏览器**：启动后 `tasklist | findstr -i "chrome msedge"` 确认无新增浏览器进程
3. **市场加载**：打开面板后 250ms 内轮询 `body.innerText` 计数"正在加载插件目录"== 1（已建立脚本）
4. **插件窗口**：pywinauto 抓取各插件窗口标题/尺寸，断言主题色与记忆生效
5. **回归**：`pnpm test`（530 项）+ 安装一个真实插件（voyager / dsh-better-sidebar）端到端

---

## 五、本次已完成的修复（随方案交付）

1. **市场面板双"正在加载目录"**：骨架区不再重复渲染进度文案，`client.js` 已重建并同步至
   - `plugins/plugin-marketplace/client/client.js`（源码产物）
   - 两个 harness home 的运行副本（`@coeasy/dsh-plugin-marketplace/client/`）
   - `apps/desktop/dist-release/win-unpacked/resources/plugin-marketplace/client/`
   - 实测：加载中文案 2 → 1，0.25s 内完成加载显示 53 卡片
2. 源码改动在 `plugins/plugin-marketplace/src/client/index.ts`（skeleton 分支），待提交固化
