/**
 * Desktop host page for the Degeneration Guard UI bundle.
 *
 * Loads the bundled UI JS (plugins/degeneration-guard/ui/bundle.js) and wires
 * the desktop preload bridge (`window.dshDesktop.degenerationGuard`, when the
 * host provides it) into the `__GUARD_HOST_BRIDGE__` contract.
 *
 * The desktop main-process IPC for `degenerationGuard` is wired via
 * degeneration-guard-host.ts → the engine loopback HTTP API; the preload
 * bridge (`window.dshDesktop.degenerationGuard`) drives it.
 */

export const GUARD_UI_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'"

/**
 * @param bundlePath - path/URL of the bundled UI JS to load.
 * @param nonce - CSP nonce for inline script (must match [A-Za-z0-9_-]{8,128}).
 */
export function guardPageHtml(bundlePath: string, nonce = 'dsh-degeneration-guard'): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(nonce)) throw new Error('invalid nonce')
  const src = bundlePath.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${GUARD_UI_CSP}; script-src 'self' 'nonce-${nonce}'" />
  <style>
    html, body { margin:0; padding:0; background:#0f1115; color:#e6e6e6; font:14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #guard-root { max-width:720px; margin:0 auto; padding:20px; }
    h3 { margin:18px 0 8px; font-size:15px; color:#cfd3da; }
    .g-status { background:#161b22; border:1px solid #30363d; border-radius:10px; padding:10px 14px; margin-bottom:14px; color:#8b949e; font-size:12px; }
    .g-ok { color:#56d364; }
    .g-error { color:#f85149; }
    .g-pause { background:#3a2d12; border:1px solid #e3b341; border-radius:10px; padding:10px 14px; margin-bottom:14px; color:#e3b341; display:flex; align-items:center; gap:12px; }
    .g-row { display:flex; align-items:center; gap:12px; padding:8px 0; }
    .g-label { width:150px; color:#cfd3da; flex-shrink:0; }
    select { background:#1c2128; color:#e6e6e6; border:1px solid #30363d; border-radius:6px; padding:5px 8px; }
    .g-btn { background:#2f6feb; border:none; color:#fff; border-radius:8px; padding:7px 14px; cursor:pointer; }
    .g-table { width:100%; border-collapse:collapse; margin-top:6px; }
    .g-table td { text-align:left; padding:6px 10px; border-bottom:1px solid #21262d; }
    .g-table td:first-child { color:#8b949e; width:45%; }
  </style>
</head>
<body>
  <div id="guard-root"></div>
  <script src="${src}"></script>
  <script nonce="${nonce}">
    window.__GUARD_HOST_BRIDGE__ = (function () {
      var host = (window.dshDesktop && window.dshDesktop.degenerationGuard) || null;
      var call = function (method) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (!host) return Promise.reject(new Error('desktop bridge unavailable (degeneration-guard host not wired yet)'));
        return host({ kind: 'call', method: method, args: args }).then(function (r) {
          if (r && r.ok === false) throw new Error(r.error || 'degeneration-guard error');
          return (r && r.data) || null;
        });
      };
      return {
        getStatus: function () { return call('getStatus'); },
        setMode: function (mode) { return call('setMode', mode); },
        resume: function () { return call('resume'); },
        getConfig: function () { return call('getConfig'); }
      };
    })();
    if (window.__GUARD_MOUNT__) window.__GUARD_MOUNT__(document.getElementById('guard-root'));
  </script>
</body>
</html>`
}
