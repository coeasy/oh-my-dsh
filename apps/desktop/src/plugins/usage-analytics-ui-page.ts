/**
 * Desktop host page for the shared Usage Analytics UI bundle.
 *
 * Served as a local HTML string opened in a dedicated window. The page loads
 * the bundled UI JS (bundled from packages/usage-analytics-ui) and wires the
 * desktop preload bridge (`window.dshDesktop.usageAnalytics`) into the shared
 * `__USAGE_HOST_BRIDGE__` contract. The UI bundle itself stays platform-
 * agnostic; only this wiring differs per platform.
 */

export const USAGE_UI_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'"

/**
 * @param bundlePath - path/URL of the bundled UI JS to load.
 * @param nonce - CSP nonce for inline script (must match [A-Za-z0-9_-]{8,128}).
 */
export function usageAnalyticsPageHtml(bundlePath: string, nonce = 'dsh-usage-bridge'): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(nonce)) throw new Error('invalid nonce')
  const src = bundlePath.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${USAGE_UI_CSP}; script-src 'self' 'nonce-${nonce}'" />
  <style>
    html, body { margin:0; padding:0; background:#0f1115; color:#e6e6e6; font:14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #root { max-width:1100px; margin:0 auto; padding:20px; }
    .qa-nav { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
    .qa-nav-btn { background:#1c2128; color:#cfd3da; border:1px solid #30363d; border-radius:8px; padding:6px 12px; cursor:pointer; text-transform:capitalize; }
    .qa-nav-btn.active { background:#2f6feb; border-color:#2f6feb; color:#fff; }
    .qa-card { background:#161b22; border:1px solid #30363d; border-radius:10px; padding:16px; }
    .qa-stat { display:flex; flex-direction:column; gap:4px; }
    .qa-stat-label { color:#8b949e; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    .qa-stat-value { font-size:24px; font-weight:600; }
    .qa-stat-hint { color:#6e7681; font-size:11px; }
    .qa-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
    .qa-table { width:100%; border-collapse:collapse; margin-top:8px; }
    .qa-table th, .qa-table td { text-align:left; padding:8px 10px; border-bottom:1px solid #21262d; }
    .qa-table th { color:#8b949e; font-weight:500; font-size:12px; }
    .qa-badge { display:inline-block; font-size:11px; padding:1px 7px; border-radius:10px; }
    .q-exact { background:#16351f; color:#56d364; }
    .q-estimated { background:#3a2d12; color:#e3b341; }
    .q-derived { background:#1f2d3a; color:#58a6ff; }
    .q-unknown { background:#2d333b; color:#8b949e; }
    .qa-pre { background:#0d1117; padding:12px; border-radius:8px; overflow:auto; font-size:12px; }
    h2 { margin:0 0 12px; font-size:18px; }
    h3 { margin:0 0 8px; font-size:14px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="${src}"></script>
  <script nonce="${nonce}">
    window.__USAGE_HOST_BRIDGE__ = (function () {
      const host = (window.dshDesktop && window.dshDesktop.usageAnalytics) || null;
      return {
        query: function (req) {
          return host ? host({ kind: 'query', payload: req }).then(function (r) {
            if (r && r.ok === false) throw new Error(r.error || 'usage analytics error');
            return { data: (r && r.data) || null };
          }) : Promise.reject(new Error('desktop bridge unavailable'));
        },
        subscribe: function () { return function () {}; },
        getCapabilities: function () { return { costEstimation: false, exportFormats: ['json', 'csv'] }; },
        openRoute: function () {}
      };
    })();
    if (window.__USAGE_MOUNT__) window.__USAGE_MOUNT__(document.getElementById('root'));
  </script>
</body>
</html>`
}
