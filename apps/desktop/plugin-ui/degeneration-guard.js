"use strict";
(() => {
  // ui-src/mount.ts
  var MODE_CARDS = [
    {
      id: "standard",
      name: "\u6807\u51C6",
      desc: "\u5E73\u8861\u8BEF\u62A5\u4E0E\u68C0\u51FA\uFF0C\u9002\u5408\u65E5\u5E38",
      accent: "#2f6feb"
    },
    {
      id: "strict",
      name: "\u4E25\u683C",
      desc: "\u66F4\u77ED\u9608\u503C\u3001\u66F4\u65E9\u62E6\u622A\u3001\u66F4\u6613\u8BEF\u62A5",
      accent: "#d29922"
    },
    {
      id: "off",
      name: "\u5173\u95ED",
      desc: "\u5B8C\u5168\u505C\u6B62\u68C0\u6D4B",
      accent: "#6e7681"
    }
  ];
  function modeCardStyle(active, accent) {
    return {
      flex: "1",
      padding: "10px 12px",
      borderRadius: "8px",
      cursor: "pointer",
      border: active ? `2px solid ${accent}` : "1px solid #30363d",
      background: active ? "rgba(47,111,235,0.08)" : "#0d1117",
      textAlign: "left",
      color: active ? "#e6edf3" : "#8b949e",
      fontFamily: "inherit",
      fontSize: "12px"
    };
  }
  function bridge() {
    const b = window.__GUARD_HOST_BRIDGE__;
    if (!b) throw new Error("__GUARD_HOST_BRIDGE__ not available");
    return b;
  }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) node.append(c);
    return node;
  }
  function mount(root) {
    root.innerHTML = "";
    const statusWrap = el("div", { class: "g-status" });
    const body = el("div", { class: "g-body" });
    root.append(statusWrap, body);
    const render = async () => {
      let status;
      let cfg;
      try {
        const b = bridge();
        [status, cfg] = await Promise.all([b.getStatus(), b.getConfig()]);
      } catch (err) {
        statusWrap.innerHTML = "";
        statusWrap.append(
          el("div", { class: "g-error" }, [
            `\u65E0\u6CD5\u8FDE\u63A5\u5BBF\u4E3B\u6865\u63A5\uFF1A${err.message}`,
            "\uFF08\u9700\u5728\u63D2\u4EF6\u5BBF\u4E3B\u9875\u9762\u5185\u52A0\u8F7D\uFF0C\u6216\u5BBF\u4E3B\u5C1A\u672A\u63A5\u7EBF degeneration-guard \u670D\u52A1\uFF09"
          ])
        );
        return;
      }
      statusWrap.innerHTML = "";
      if (status.active.paused) {
        const bar = el("div", { class: "g-pause" }, [`\u26A0 \u5DF2\u6682\u505C\uFF1A${status.active.pauseReason ?? ""}`]);
        const resumeBtn = el("button", { class: "g-btn" }, ["\u7EE7\u7EED\uFF08\u7528\u6237\u51B3\u7B56\uFF09"]);
        resumeBtn.addEventListener("click", async () => {
          await bridge().resume();
          render();
        });
        bar.append(resumeBtn);
        statusWrap.append(bar);
      } else {
        statusWrap.append(
          el("div", { class: "g-ok" }, [
            `\u6A21\u5F0F\uFF1A${status.mode} \xB7 \u68C0\u6D4B ${status.stats.thinkingChecks} \xB7 \u547D\u4E2D ${status.stats.thinkingHits} \xB7 \u91CD\u8BD5 ${status.stats.retries} \xB7 \u6682\u505C ${status.stats.pauses} \xB7 \u5DE5\u5177\u63D0\u9192 ${status.stats.toolRepeatWarns} \xB7 \u8F6E\u6B21\u63D0\u9192 ${status.stats.turnReminders}`,
            ` host: ${status.host.interrupt ? "interrupt\u2713" : "interrupt\u2717"}`
          ])
        );
      }
      body.innerHTML = "";
      const modeHeading = el("div", { class: "g-label" }, ["\u8FD0\u884C\u6863\u4F4D"]);
      body.append(modeHeading);
      const modeCards = el(
        "div",
        { style: "display:flex; gap:8px; margin:2px 0 8px;" },
        MODE_CARDS.map((m) => {
          const active = status.mode === m.id;
          const card = el(
            "button",
            {
              style: Object.entries(modeCardStyle(active, m.accent)).map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`).join(";"),
              title: m.desc
            },
            [
              el("div", { style: "font-weight:600; font-size:13px;" }, [m.name]),
              el("div", { style: "margin-top:3px; opacity:0.85; line-height:1.4;" }, [m.desc])
            ]
          );
          card.addEventListener("click", async () => {
            if (active) return;
            await bridge().setMode(m.id);
            render();
          });
          return card;
        })
      );
      body.append(modeCards);
      const restoreBtn = el("button", { class: "g-btn" }, ["\u6062\u590D\u9ED8\u8BA4\uFF08\u6807\u51C6\u9884\u8BBE\uFF09"]);
      restoreBtn.style.background = "#21262d";
      restoreBtn.style.color = "#e6edf3";
      restoreBtn.style.border = "1px solid #30363d";
      restoreBtn.addEventListener("click", async () => {
        await bridge().setMode("standard");
        render();
      });
      const restoreRow = el("div", { class: "g-row" }, [restoreBtn]);
      body.append(restoreRow);
      body.append(el("h3", {}, ["\u68C0\u6D4B\u53C2\u6570"]));
      const params = [
        ["\u601D\u8003\u6863\u4F4D\u6A21\u5F0F", cfg.mode],
        ["\u81EA\u52A8\u91CD\u8BD5\u4E00\u6B21", String(cfg.autoRetry)],
        ["\u91CD\u590D\u6A21\u5F0F\u957F\u5EA6\u4E0B\u9650", String(cfg.stream.minPatternSize)],
        ["\u91CD\u590D\u6A21\u5F0F\u957F\u5EA6\u4E0A\u9650", String(cfg.stream.maxPatternSize)],
        ["\u8FDE\u7EED\u91CD\u590D\u6B21\u6570", String(cfg.stream.minCount)],
        ["\u6EDA\u52A8\u7A97\u53E3", String(cfg.stream.windowChars)],
        ["\u601D\u8003\u6BB5\u957F\u5EA6\u4E0A\u9650", String(cfg.stream.maxThinkingChars)],
        ["\u54CD\u5E94\u957F\u5EA6\u4E0A\u9650", String(cfg.stream.maxResponseChars)],
        ["\u5DE5\u5177\u786C\u505C\u6B62\u9608\u503C", String(cfg.tool.hardStop)],
        ["\u4F1A\u8BDD\u8F6E\u6B21\u4E0A\u9650\uFF08\u63D0\u9192\uFF09", String(cfg.maxTurnsPerSession)]
      ];
      const table = el("table", { class: "g-table" });
      for (const [k, v] of params) {
        const tr = el("tr", {}, []);
        tr.append(el("td", {}, [k]), el("td", {}, [v]));
        table.append(tr);
      }
      body.append(table);
    };
    void render();
  }
  window.__GUARD_MOUNT__ = mount;
  function autoMount() {
    const root = document.getElementById("guard-root");
    if (root) mount(root);
  }
})();
