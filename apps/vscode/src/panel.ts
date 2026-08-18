/** Webview HTML is a plain string — keep vscode / runtime imports out so node:test can cover CSP. */

export const WEBVIEW_CSP =
  "default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'"

export function panelHtml(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`refusing to load non-loopback URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    throw new Error(`refusing to load non-loopback URL: ${url}`)
  }
  const escaped = url.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${WEBVIEW_CSP}" />
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; background: #111; }
  </style>
</head>
<body>
  <iframe src="${escaped}" title="DeepSeek Harness"></iframe>
</body>
</html>`
}
