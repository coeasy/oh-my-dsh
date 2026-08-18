# DeepSeek Harness for VS Code

Cursor can install the same VSIX. First period loads the existing DSH Web SPA in a Webview iframe (`frame-src http://127.0.0.1:*`).

Command: **DeepSeek Harness: Open** / **DeepSeek Harness: Stop**

Webview CSP: `default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'`

Local F5 prefers `runtime/stage` then the gitignored `deepseek-harness/` clone. `DSH_RUNTIME=local` / setting `dsh.runtime=local` still uses PATH `dsh`. Press F5 with `.vscode/launch.json`.

Settings:

- `dsh.runtime`: `local` | `download`
- `dsh.downloadUrl`: D3 下载地址（可空，回落到 `DSH_RUNTIME_URL`）

安装后的 VSIX 默认 `dsh.runtime=download`（未改用户设置时）。F5 开发优先用仓库克隆，而不是 PATH 上可能过期的 `dsh`。

```powershell
pnpm pack:vscode
```

产出 `apps/vscode/*.vsix`。Cursor 与 VS Code 均可 `Install from VSIX`。
