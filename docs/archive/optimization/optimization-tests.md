# P0：测试覆盖补齐

> 目标：为插件市场核心逻辑补充单测，并覆盖关键回归路径。
> 优先级：★★★★★（核心逻辑当前零覆盖，回归风险高）。

## 现状

- 全仓 44 个测试文件，分布在 `apps/desktop`（29）、`packages/client-runtime`（13）、`apps/vscode`（2）、`plugins/embedded-client`（1）。
- `plugins/plugin-marketplace` **完全没有测试**，其 `src/` 下约 1200 行核心逻辑（路径解析、安装/卸载、备份/恢复、npm 校验、前端状态机）无任何保护。

## 需要覆盖的模块与用例

### M1. `registry.ts` — 官方目录对齐（最高优先）

| 用例 | 预期 |
|---|---|
| `dshHomeOf(undefined)` | 返回 `~/.dsh`（HOMEDRIVE+HOMEPATH 拼接） |
| `dshHomeOf('~/.my_dsh')` | 返回展开后的 `~/.my_dsh` |
| `dshHomeOf(configured)` 优先于 env | configured 非空时优先 |
| `profileDirOf('web')` | `<home>/profiles/web` |
| `readOfficialState` 读取 `package.json` 依赖 | 正确解析 dependencies 与 dsh.profile.bundles |
| 安装状态 `isInstalled` | 已安装/未安装/依赖但在 bundles 中 shadow 三态正确 |

### M2. `install.ts` — CLI 封装

- `installSpecOf(entry)`：无 pkg_name 时用 full_name，有 npm 时用 `npm:` spec。
- `childEnv(home)` 正确设置 `DSH_HOME`。
- `runPluginCommand` 参数组装（`plugin --profile <p> add/remove <spec>`），用 mock spawn。

### M3. `backup.ts` — 备份/恢复往返

- `buildBackup` 生成符合 `BACKUP_FORMAT` 的结构。
- `restoreBackup` 对合法备份可还原出预期依赖集合。
- 非法/损坏备份被拒绝并报错。

### M4. `verify.ts` — npm 校验

- lifecycle scripts 检测：含 `install/preinstall/postinstall/prepare` 时返回警告。
- squat 判定：npm 仓库地址与来源不一致时返回 `squat=true`。
- 非 npm spec（如 file:/git:）正确跳过。

### M5. `uninstall.ts` — 跨平台卸载

- Windows：mock `reg.exe` 查询 UninstallString，返回 NSIS 卸载器路径。
- mac/linux：返回手动卸载提示。

### M6. `catalog.ts` — 多源目录

- 每源 `MAX_PER_SOURCE=100` 生效（slice 边界）。
- `merge` 按 priority 去重（低 priority 覆盖高）。
- 单源失败返回空数组不抛异常。

### M7. 前端状态机（可选，成本较高）

- `client/index.ts` 的渐进加载（逐源合并、进度计数、失败兜底）若可行用 jsdom/轻量渲染测试；至少对纯函数（sorted 过滤、分类、SRC_ORDER 合并）做单元验证。

## 实施方式

- 使用仓库现有 `node --experimental-strip-types --test` 模式（与 `pnpm test` 一致），在 `plugins/plugin-marketplace/tests/*.test.ts` 新建。
- 对网络/子进程依赖（fetch、spawn、reg.exe）一律 mock，保证离线可跑、快速稳定。
- 将新测试并入根 `package.json` 的 `test` 脚本覆盖范围。

## 验收标准

- [ ] `plugins/plugin-marketplace/tests/` 存在且覆盖 M1–M5。
- [ ] `pnpm test` 全绿（含新增），离线可运行。
- [ ] 关键路径（路径解析、安装状态、备份往返）有断言保护。
