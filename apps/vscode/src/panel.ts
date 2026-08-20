/** Webview HTML is a plain string — keep vscode / runtime imports out so node:test can cover CSP. */

export const WEBVIEW_CSP =
  "default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'"

export function panelHtml(url: string, nonce = 'dsh-market-bridge'): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`refusing to load non-loopback URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) {
    throw new Error(`refusing to load non-loopback URL: ${url}`)
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(nonce)) throw new Error('invalid webview nonce')
  const escaped = url.replace(/"/g, '&quot;')
  const origin = JSON.stringify(parsed.origin)
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${WEBVIEW_CSP}; script-src 'nonce-${nonce}'" />
  <style>
    html, body, iframe { margin: 0; padding: 0; width: 100%; height: 100%; border: 0; background: #111; }
  </style>
</head>
<body>
  <iframe id="dsh-frame" src="${escaped}" title="DeepSeek Harness"></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('dsh-frame');
    const expectedOrigin = ${origin};
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.channel === 'dsh-market-request') {
        if (event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
        vscode.postMessage(data);
        return;
      }
      if (data.channel === 'dsh-market-response') {
        frame.contentWindow.postMessage(data, expectedOrigin);
      }
    });
  </script>
</body>
</html>`
}
