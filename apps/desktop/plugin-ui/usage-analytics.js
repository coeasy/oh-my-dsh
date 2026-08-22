"use strict";
(() => {
  // packages/usage-analytics-ui/src/bridge.ts
  function getBridge(w = globalThis) {
    return w.__USAGE_HOST_BRIDGE__ ?? null;
  }

  // packages/usage-analytics-ui/src/format.ts
  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function formatToken(v) {
    if (v === null || v === void 0) return "\u2014";
    return v.toLocaleString("en-US");
  }
  function formatCost(v, currency) {
    if (v === null || v === void 0) return "\u2014";
    const sym = currency === "CNY" ? "\xA5" : "$";
    return `${sym}${v.toFixed(4)}`;
  }
  function formatPercent(v) {
    if (v === null || v === void 0) return "\u2014";
    return `${(v * 100).toFixed(1)}%`;
  }
  function formatDate(iso) {
    const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
  }

  // packages/usage-analytics-ui/src/views.ts
  function statCard(label, value, hint = "") {
    return `<div class="qa-card qa-stat"><div class="qa-stat-label">${esc(label)}</div><div class="qa-stat-value">${value}</div>${hint ? `<div class="qa-stat-hint">${esc(hint)}</div>` : ""}</div>`;
  }
  function renderOverview(overview, costEnabled) {
    const cards = [
      statCard("Requests", formatToken(overview.request_count)),
      statCard("Input tokens", formatToken(overview.input_tokens_exact)),
      statCard("Output tokens", formatToken(overview.output_tokens_exact)),
      statCard("Cache reads", formatToken(overview.cache_read_requests)),
      statCard(
        "Cache unknown",
        formatToken(overview.cache_status_unknown_count),
        "provider did not report"
      ),
      statCard("Error rate", formatPercent(overview.error_rate)),
      statCard("P50 latency", overview.latency_p50 === null ? "\u2014" : `${overview.latency_p50}ms`),
      statCard("P95 latency", overview.latency_p95 === null ? "\u2014" : `${overview.latency_p95}ms`)
    ];
    if (costEnabled) {
      cards.splice(
        0,
        0,
        statCard(
          "Est. cost",
          formatCost(overview.estimated_cost_value, "USD"),
          "estimated, local only"
        )
      );
    }
    return `<section class="qa-page" data-route="overview"><h2>Overview</h2><div class="qa-grid">${cards.join("")}</div></section>`;
  }
  function renderProviders(providers, costEnabled) {
    const rows = providers.map((p) => {
      const cost = costEnabled ? `<td>${formatCost(p.estimated_cost_value, "USD")}</td>` : "";
      return `<tr><td>${esc(p.provider_id)}</td><td>${formatToken(p.request_count)}</td><td>${formatToken(p.success_count)}</td><td>${formatToken(p.error_count)}</td><td>${formatPercent(p.error_rate)}</td><td>${formatToken(p.input_tokens_exact)}</td><td>${formatToken(p.output_tokens_exact)}</td><td>${formatToken(p.cache_read_requests)}</td>${cost}</tr>`;
    }).join("");
    const costHead = costEnabled ? "<th>Est. cost</th>" : "";
    return `<section class="qa-page" data-route="providers"><h2>Providers</h2><table class="qa-table"><thead><tr><th>Provider</th><th>Requests</th><th>Success</th><th>Errors</th><th>Error rate</th><th>Input</th><th>Output</th><th>Cache reads</th>${costHead}</tr></thead><tbody>${rows || '<tr><td colspan="8">No data</td></tr>'}</tbody></table></section>`;
  }
  function renderCache(cache) {
    const hit = cache.hit_rate === null ? '<span class="qa-badge q-unknown" title="no known cache data; not reported as a miss">unknown</span>' : formatPercent(cache.hit_rate);
    return `<section class="qa-page" data-route="cache"><h2>Cache</h2><div class="qa-grid">${[
      statCard("Total requests", formatToken(cache.total_requests)),
      statCard("Cache reads", formatToken(cache.cache_read_requests)),
      statCard("Cache writes", formatToken(cache.cache_write_requests)),
      statCard("Cache creations", formatToken(cache.cache_creation_requests)),
      statCard("Cache unknown", formatToken(cache.cache_status_unknown_count)),
      statCard("Cache read tokens", formatToken(cache.cache_read_tokens_exact)),
      statCard("Hit rate (known only)", hit)
    ].join("")}</div></section>`;
  }
  function renderTrend(points) {
    const rows = points.map((p) => {
      return `<tr><td>${esc(p.date)}</td><td>${formatToken(p.request_count)}</td><td>${formatToken(p.input_tokens_exact)}</td><td>${formatToken(p.output_tokens_exact)}</td><td>${formatToken(p.cache_read_requests)}</td><td>${formatToken(p.error_count)}</td><td>${formatCost(p.estimated_cost_value, "USD")}</td></tr>`;
    }).join("");
    return `<section class="qa-page" data-route="trend"><h2>Daily trend</h2><table class="qa-table"><thead><tr><th>Date</th><th>Requests</th><th>Input</th><th>Output</th><th>Cache reads</th><th>Errors</th><th>Est. cost</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No data</td></tr>'}</tbody></table></section>`;
  }
  function renderModels(models) {
    const rows = models.map((m) => {
      return `<tr><td>${esc(m.model_id ?? "\u2014")}</td><td>${formatToken(m.request_count)}</td><td>${formatToken(m.input_tokens_exact)}</td><td>${formatToken(m.output_tokens_exact)}</td></tr>`;
    }).join("");
    return `<section class="qa-page" data-route="models"><h2>Models</h2><table class="qa-table"><thead><tr><th>Model</th><th>Requests</th><th>Input</th><th>Output</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No data</td></tr>'}</tbody></table></section>`;
  }
  function renderSessions(events) {
    const rows = events.map((e) => {
      return `<tr><td>${esc(e.logical_request_id)}</td><td>${esc(e.provider_id)}</td><td>${esc(e.model_id ?? "\u2014")}</td><td>${formatDate(e.observed_at)}</td><td>${esc(e.status)}</td><td>${formatToken(e.input_tokens)}</td><td>${formatToken(e.output_tokens)}</td><td>${formatToken(e.cache_read_tokens)}</td><td>${formatCost(e.cost_value, e.cost_currency)}</td></tr>`;
    }).join("");
    return `<section class="qa-page" data-route="sessions"><h2>Events</h2><table class="qa-table"><thead><tr><th>Request</th><th>Provider</th><th>Model</th><th>Date</th><th>Status</th><th>Input</th><th>Output</th><th>Cache read</th><th>Est. cost</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No events</td></tr>'}</tbody></table></section>`;
  }
  function renderSettings(capabilities, status) {
    return `<section class="qa-page" data-route="settings"><h2>Settings</h2><div class="qa-card"><h3>Status</h3><pre class="qa-pre">${esc(JSON.stringify(status, null, 2))}</pre></div><div class="qa-card"><h3>Capabilities</h3><ul><li>Cost estimation: ${capabilities.costEstimation ? "enabled" : "disabled (default)"}</li><li>Export formats: ${esc(capabilities.exportFormats.join(", ") || "none")}</li></ul></div></section>`;
  }
  var ROUTES = [
    "overview",
    "trend",
    "providers",
    "models",
    "cache",
    "sessions",
    "settings"
  ];

  // packages/usage-analytics-ui/src/app.ts
  var UsageAnalyticsApp = class {
    container;
    bridge;
    costEnabled;
    currentRoute = "overview";
    unsubs = [];
    refreshTimer = null;
    constructor(opts) {
      this.container = opts.container;
      this.bridge = opts.bridge ?? getBridge() ?? null;
      this.costEnabled = opts.costEnabled ?? false;
    }
    async render() {
      if (!this.bridge) {
        this.container.innerHTML = '<div class="qa-card">Usage Analytics is not connected to a host. Install/enable the plugin and relaunch.</div>';
        return;
      }
      const range = { range: "today" };
      let html = "";
      switch (this.currentRoute) {
        case "overview": {
          const res = await this.bridge.query({ view: "overview", ...range });
          html = renderOverview(res.data ?? {}, this.costEnabled);
          break;
        }
        case "trend": {
          const res = await this.bridge.query({ view: "trend", ...range });
          html = renderTrend(res.data ?? []);
          break;
        }
        case "providers": {
          const res = await this.bridge.query({ view: "providers", ...range });
          html = renderProviders(res.data ?? [], this.costEnabled);
          break;
        }
        case "models": {
          const res = await this.bridge.query({ view: "models", ...range });
          html = renderModels(res.data ?? []);
          break;
        }
        case "cache": {
          const res = await this.bridge.query({ view: "cache", ...range });
          html = renderCache(res.data ?? {});
          break;
        }
        case "sessions": {
          const res = await this.bridge.query({ view: "events", ...range });
          html = renderSessions(res.data ?? []);
          break;
        }
        case "settings": {
          const caps = this.bridge.getCapabilities();
          const res = await this.bridge.query({ view: "settings", ...range });
          html = renderSettings(caps, res.data);
          break;
        }
      }
      this.container.innerHTML = `<nav class="qa-nav">${this.navHtml()}</nav>${html}`;
      this.bindNav();
    }
    navHtml() {
      const items = ROUTES.map(
        (r) => `<button class="qa-nav-btn ${r === this.currentRoute ? "active" : ""}" data-route="${r}">${r}</button>`
      ).join("");
      return items;
    }
    bindNav() {
      this.container.querySelectorAll(".qa-nav-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.currentRoute = btn.dataset.route ?? "overview";
          void this.render();
        });
      });
    }
    mount() {
      this.container.innerHTML = '<div class="qa-card">Loading\u2026</div>';
      if (this.bridge) {
        this.unsubs.push(
          this.bridge.subscribe("usage.aggregate.updated", () => this.debouncedRefresh())
        );
        this.unsubs.push(this.bridge.subscribe("usage.event.created", () => this.debouncedRefresh()));
      }
      this.refreshTimer = setInterval(() => void this.render(), 15e3);
      void this.render();
    }
    lastRefresh = 0;
    debouncedRefresh() {
      const now = Date.now();
      if (now - this.lastRefresh < 1e3) return;
      this.lastRefresh = now;
      void this.render();
    }
    destroy() {
      for (const un of this.unsubs) un();
      this.unsubs = [];
      if (this.refreshTimer) clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  };
  function mountUsageAnalytics(opts) {
    const app = new UsageAnalyticsApp(opts);
    app.mount();
    return app;
  }

  // packages/usage-analytics-ui/src/mount-global.ts
  window.__USAGE_MOUNT__ = (container) => {
    return mountUsageAnalytics({ container, bridge: getBridge() ?? void 0 });
  };
})();
