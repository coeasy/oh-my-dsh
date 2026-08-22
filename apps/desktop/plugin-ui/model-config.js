"use strict";
(() => {
  // ui-src/mount.ts
  var STAGES = [
    { id: "default", label: "\u9ED8\u8BA4\u6A21\u578B" },
    { id: "planning", label: "\u72EC\u7ACB\u89C4\u5212\u6A21\u578B" },
    { id: "subagent", label: "\u5B50\u4EE3\u7406\u6A21\u578B" },
    { id: "evaluation", label: "\u8BC4\u4F30\u6A21\u578B" }
  ];
  function bridge() {
    const b = window.__MODEL_CONFIG_HOST_BRIDGE__;
    if (!b) throw new Error("__MODEL_CONFIG_HOST_BRIDGE__ not available");
    return b;
  }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) node.append(c);
    return node;
  }
  function sel(attrs = {}, children = []) {
    return el("select", attrs, children);
  }
  function inp(attrs = {}) {
    return el("input", attrs);
  }
  function mount(root) {
    root.innerHTML = "";
    const statusWrap = el("div", { class: "mc-status" });
    const body = el("div", { class: "mc-body" });
    root.append(statusWrap, body);
    const render = async () => {
      let status;
      let doc;
      let catalog = null;
      try {
        const b = bridge();
        [status, doc] = await Promise.all([b.getStatus(), b.getDocument()]);
        try {
          catalog = await b.getCatalog();
        } catch {
          catalog = null;
        }
      } catch (err) {
        statusWrap.innerHTML = "";
        statusWrap.append(
          el("div", { class: "mc-error" }, [
            `\u65E0\u6CD5\u8FDE\u63A5\u5BBF\u4E3B\u6865\u63A5\uFF1A${err.message}`,
            "\uFF08\u684C\u9762\u7AEF\u9700\u5728\u63D2\u4EF6\u5BBF\u4E3B\u9875\u9762\u5185\u52A0\u8F7D\uFF0C\u6216\u5BBF\u4E3B\u5C1A\u672A\u63A5\u7EBF model-config \u670D\u52A1\uFF09"
          ])
        );
        return;
      }
      statusWrap.innerHTML = "";
      statusWrap.append(
        el("div", { class: "mc-hint" }, [
          `\u751F\u6548\u8303\u56F4\uFF1A\u914D\u7F6E\u5F71\u54CD\u65B0\u4F1A\u8BDD\u4E0E\u65B0\u6D3E\u53D1\u7684\u5B50\u4EE3\u7406\uFF1B\u5DF2\u6709\u4F1A\u8BDD\u6CBF\u7528\u5404\u81EA\u4FDD\u5B58\u7684\u9009\u62E9\u3002`,
          ` host: ${status.host.modelSwitch ? "modelSwitch\u2713" : "modelSwitch\u2717"} \xB7 ${status.host.planMode ? "planMode\u2713" : "planMode\u2717"} \xB7 ${status.host.subagent ? "subagent\u2713" : "subagent\u2717"} \xB7 revision ${status.revision}`
        ])
      );
      body.innerHTML = "";
      body.append(el("h3", {}, ["\u4F7F\u7528\u6A21\u578B"]));
      for (const stage of STAGES) {
        const setting = (doc.stages ?? {})[stage.id] ?? {
          follow: stage.id === "default" ? null : "default"
        };
        const isDefault = stage.id === "default";
        const binding = setting.binding;
        const row = el("div", { class: "mc-row" });
        const label = el("label", { class: "mc-label" }, [stage.label]);
        row.append(label);
        const controls = el("div", { class: "mc-controls" });
        if (isDefault) {
          const [prov, model, effort, budget] = modelSelectors(catalog, binding);
          controls.append(prov, model, effort, budget);
        } else {
          const followSel = sel({});
          followSel.append(
            el("option", { value: "follow" }, ["\u4F7F\u7528\u5F53\u524D\u6A21\u578B\uFF08\u8DDF\u968F\u9ED8\u8BA4\uFF09"]),
            el("option", { value: "independent" }, ["\u72EC\u7ACB\u9009\u62E9\u6A21\u578B\u2026"])
          );
          followSel.value = binding ? "independent" : "follow";
          followSel.addEventListener("change", () => {
            const follow = followSel.value === "follow";
            void bridge().setStage(stage.id, follow ? { follow: "default" } : { follow: null });
            void render();
          });
          controls.append(followSel);
          if (binding) {
            const [prov, model, effort, budget] = modelSelectors(catalog, binding, stage.id);
            controls.append(prov, model, effort, budget);
          }
        }
        row.append(controls);
        body.append(row);
      }
      body.append(el("h3", {}, ["\u573A\u666F\u9884\u8BBE"]));
      const profileRow = el("div", { class: "mc-row" });
      const profileLabel = el("label", { class: "mc-label" }, ["\u542F\u7528\u9884\u8BBE"]);
      const profileSel = sel({});
      profileSel.append(el("option", { value: "" }, ["\u65E0"]));
      for (const [pid, p] of Object.entries(doc.profiles ?? {})) {
        profileSel.append(el("option", { value: pid }, [`${p.label} (${pid})`]));
      }
      profileSel.value = doc.activeProfile ?? "";
      profileSel.addEventListener("change", () => {
        void bridge().setProfile(profileSel.value || null).then(() => render());
      });
      profileRow.append(profileLabel, profileSel);
      body.append(profileRow);
      const actions = el("div", { class: "mc-actions" }, []);
      const applyBtn = el("button", { class: "mc-btn" }, ["\u5E94\u7528\u9ED8\u8BA4\u6A21\u578B\u5230\u5F15\u64CE"]);
      applyBtn.addEventListener("click", () => {
        void bridge().applyDefaultToEngine().then((r) => {
          statusWrap.append(
            el("div", { class: "mc-msg" }, [r.ok ? "\u5DF2\u5E94\u7528" : `\u672A\u5E94\u7528\uFF1A${r.reason ?? "\u672A\u77E5"}`])
          );
        });
      });
      const resetBtn = el("button", { class: "mc-btn mc-btn-danger" }, ["\u91CD\u7F6E\u914D\u7F6E"]);
      resetBtn.addEventListener("click", () => {
        if (confirm("\u91CD\u7F6E\u6240\u6709\u6A21\u578B\u914D\u7F6E\uFF1F")) {
          void bridge().reset().then(() => render());
        }
      });
      actions.append(applyBtn, resetBtn);
      body.append(actions);
    };
    void render();
  }
  function modelSelectors(catalog, binding, stageId) {
    const providers = catalog?.providers ?? [];
    const provSel = sel({ class: "mc-provider" });
    provSel.append(el("option", { value: "" }, ["\u9009\u62E9 provider\u2026"]));
    for (const p of providers) provSel.append(el("option", { value: p.id }, [p.id]));
    if (binding) provSel.value = binding.provider;
    const modelSel = sel({ class: "mc-model" });
    modelSel.append(el("option", { value: "" }, ["\u9009\u62E9 model\u2026"]));
    const currentProvider = providers.find((p) => p.id === (binding?.provider ?? provSel.value));
    for (const m of currentProvider?.models ?? []) modelSel.append(el("option", { value: m }, [m]));
    if (binding) modelSel.value = binding.model;
    const effortSel = sel({ class: "mc-effort" });
    effortSel.append(el("option", { value: "" }, ["\u601D\u8003\u6863\u4F4D\uFF1A\u9ED8\u8BA4\uFF08\u670D\u52A1\u65B9\u51B3\u5B9A\uFF09"]));
    const efforts = currentProvider?.efforts?.[modelSel.value] ?? [];
    for (const e of efforts) effortSel.append(el("option", { value: e.id }, [e.label ?? e.id]));
    if (binding?.reasoningEffort) effortSel.value = binding.reasoningEffort;
    const budget = inp({
      class: "mc-budget",
      type: "number",
      min: "0",
      placeholder: "thinkingBudget"
    });
    if (binding?.thinkingBudget !== void 0) budget.value = String(binding.thinkingBudget);
    const commit = () => {
      if (!provSel.value || !modelSel.value) return;
      const setting = {
        follow: null,
        binding: {
          provider: provSel.value,
          model: modelSel.value,
          ...effortSel.value ? { reasoningEffort: effortSel.value } : {}
        }
      };
      const budgetVal = Number(budget.value);
      if (Number.isFinite(budgetVal) && budgetVal >= 0 && budget.value !== "") {
        setting.binding.thinkingBudget = budgetVal;
      }
      void bridge().setStage(stageId ?? "default", setting);
    };
    provSel.addEventListener("change", () => {
      modelSel.innerHTML = "";
      modelSel.append(el("option", { value: "" }, ["\u9009\u62E9 model\u2026"]));
      const p = providers.find((x) => x.id === provSel.value);
      for (const m of p?.models ?? []) modelSel.append(el("option", { value: m }, [m]));
      effortSel.innerHTML = "";
      effortSel.append(el("option", { value: "" }, ["\u601D\u8003\u6863\u4F4D\uFF1A\u9ED8\u8BA4\uFF08\u670D\u52A1\u65B9\u51B3\u5B9A\uFF09"]));
      commit();
    });
    modelSel.addEventListener("change", () => {
      effortSel.innerHTML = "";
      effortSel.append(el("option", { value: "" }, ["\u601D\u8003\u6863\u4F4D\uFF1A\u9ED8\u8BA4\uFF08\u670D\u52A1\u65B9\u51B3\u5B9A\uFF09"]));
      const p = providers.find((x) => x.id === provSel.value);
      for (const e of p?.efforts?.[modelSel.value] ?? []) {
        effortSel.append(el("option", { value: e.id }, [e.label ?? e.id]));
      }
      commit();
    });
    effortSel.addEventListener("change", () => commit());
    budget.addEventListener("change", () => commit());
    return [provSel, modelSel, effortSel, budget];
  }
  window.__MODEL_CONFIG_MOUNT__ = mount;
  function autoMount() {
    const root = document.getElementById("model-config-root");
    if (root) mount(root);
  }
})();
