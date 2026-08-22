/**
 * Desktop host page for the Model Config UI bundle.
 *
 * Served as a local HTML string opened in a dedicated window. Loads the
 * bundled UI JS (plugins/model-config/ui/bundle.js) and wires the desktop
 * preload bridge (`window.dshDesktop.modelConfig`, when the host provides it)
 * into the `__MODEL_CONFIG_HOST_BRIDGE__` contract. The bundle itself stays
 * platform-agnostic; only this wiring differs per platform.
 *
 * The desktop main-process IPC for `modelConfig` is wired via
 * model-config-host.ts → the engine loopback HTTP API; the preload bridge
 * (`window.dshDesktop.modelConfig`) drives it.
 */

export const MODEL_CONFIG_UI_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'"

/**
 * @param bundlePath - path/URL of the bundled UI JS to load.
 * @param nonce - CSP nonce for inline script (must match [A-Za-z0-9_-]{8,128}).
 */
export function modelConfigPageHtml(bundlePath: string, nonce = 'dsh-model-config'): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(nonce)) throw new Error('invalid nonce')
  const src = bundlePath.replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${MODEL_CONFIG_UI_CSP}; script-src 'self' 'nonce-${nonce}'" />
  <style>
    html, body { margin:0; padding:0; background:#0f1115; color:#e6e6e6; font:14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #model-config-root { max-width:820px; margin:0 auto; padding:20px; }
    h3 { margin:18px 0 8px; font-size:15px; color:#cfd3da; }
    .mc-status { background:#161b22; border:1px solid #30363d; border-radius:10px; padding:10px 14px; margin-bottom:14px; color:#8b949e; font-size:12px; }
    .mc-error { color:#f85149; }
    .mc-row { display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid #21262d; }
    .mc-label { width:150px; color:#cfd3da; flex-shrink:0; }
    .mc-controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    select, input[type=number] { background:#1c2128; color:#e6e6e6; border:1px solid #30363d; border-radius:6px; padding:5px 8px; }
    .mc-budget { width:90px; }
    .mc-actions { margin-top:16px; display:flex; gap:10px; }
    .mc-btn { background:#2f6feb; border:none; color:#fff; border-radius:8px; padding:7px 14px; cursor:pointer; }
    .mc-btn-danger { background:#3a1d1d; color:#f85149; }
    .mc-msg { color:#56d364; margin-top:6px; }
  </style>
</head>
<body>
  <div id="model-config-root"></div>
  <script src="${src}"></script>
  <script nonce="${nonce}">
    window.__MODEL_CONFIG_HOST_BRIDGE__ = (function () {
      var host = (window.dshDesktop && window.dshDesktop.modelConfig) || null;
      var call = function (method) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (!host) return Promise.reject(new Error('desktop bridge unavailable (model-config host not wired yet)'));
        return host({ kind: 'call', method: method, args: args }).then(function (r) {
          if (r && r.ok === false) throw new Error(r.error || 'model-config error');
          return (r && r.data) || null;
        });
      };
      return {
        getStatus: function () { return call('getStatus'); },
        getDocument: function () { return call('getDocument'); },
        getResolved: function () { return call('getResolved'); },
        getCatalog: function () { return call('getCatalog'); },
        setStage: function (stage, setting) { return call('setStage', stage, setting); },
        setProfile: function (id) { return call('setProfile', id); },
        saveProfile: function (p) { return call('saveProfile', p); },
        deleteProfile: function (id) { return call('deleteProfile', id); },
        reset: function () { return call('reset'); },
        applyDefaultToEngine: function () { return call('applyDefaultToEngine'); }
      };
    })();
    if (window.__MODEL_CONFIG_MOUNT__) window.__MODEL_CONFIG_MOUNT__(document.getElementById('model-config-root'));
  </script>
</body>
</html>`
}
