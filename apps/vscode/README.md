# DeepSeek Harness for VS Code

Cursor can install the same VSIX. First period loads the existing DSH Web SPA in a Webview iframe (`frame-src http://127.0.0.1:*`).

Command: **DeepSeek Harness: Open** / **DeepSeek Harness: Stop**

Webview CSP: `default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'`

Local F5 prefers `runtime/stage` then the gitignored `deepseek-harness/` clone. `DSH_RUNTIME=local` / setting `dsh.runtime=local` still uses PATH `dsh`. Press F5 with `.vscode/launch.json`.

Settings:

- `dsh.runtime`: `local` | `download`
- `dsh.downloadUrl`: D3 下载地址（可空，回落到 `DSH_RUNTIME_URL`）

安装后的 VSIX 默认 `dsh.runtime=local`。只有显式选择 `download` 并配置可信下载源时才会下载运行时；F5 开发仍优先使用仓库克隆。

```powershell
pnpm pack:vscode
```

产出 `apps/vscode/*.vsix`。Cursor 与 VS Code 均可 `Install from VSIX`。
