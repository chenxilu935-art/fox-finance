var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FoxFinancePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian8 = require("obsidian");

// finance.ts
var import_obsidian = require("obsidian");
var TRANSACTION_TYPE_LABELS = {
  income: "\u6536\u5165",
  expense: "\u652F\u51FA",
  transfer: "\u8D26\u6237\u8F6C\u79FB",
  investment_in: "\u6295\u8D44\u6295\u5165",
  investment_return: "\u6295\u8D44\u6536\u76CA",
  refund: "\u9000\u6B3E",
  balance_adjust: "\u4F59\u989D\u8C03\u6574"
};
var LEDGER_DIR = "Finance/Ledger";
var INBOX_DIR = "Finance/Inbox";
var TABLE_HEADER = "| date | type | amount | account | toAccount | category | subcategory | note | tags |";
var TABLE_SEP = "|------|------|--------|---------|-----------|----------|-------------|------|------|";
var FinanceDataLayer = class {
  constructor(app) {
    this.app = app;
  }
  get adapter() {
    return this.app.vault.adapter;
  }
  // ─── Directories ─────────────────────────────────
  async ensureDirectories() {
    for (const dir of [LEDGER_DIR, INBOX_DIR]) {
      if (!await this.adapter.exists(dir)) {
        await this.adapter.mkdir(dir);
      }
    }
  }
  // ─── Ledger ──────────────────────────────────────
  /** 读取某个月的账本流水 */
  async readLedger(year, month) {
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    return this.readLedgerFile(`${LEDGER_DIR}/${ym}.md`);
  }
  /** 向账本追加一笔交易，自动更新 frontmatter 汇总 */
  async appendToLedger(tx) {
    const [year, month] = tx.date.split("-");
    if (!year || !month)
      throw new Error(`Invalid transaction date: ${tx.date}`);
    const existing = await this.readLedger(year, month);
    existing.push(tx);
    const content = this.buildLedgerContent(year, month, existing);
    await this.adapter.write(`${LEDGER_DIR}/${year}-${month}.md`, content);
    this.app.workspace.trigger("fox-finance:updated");
  }
  /** 修改账本某月的第 index 笔交易（0-based） */
  async updateTx(year, month, index, tx) {
    const existing = await this.readLedger(year, month);
    if (index < 0 || index >= existing.length)
      throw new Error(`Transaction index ${index} out of range`);
    existing[index] = tx;
    const content = this.buildLedgerContent(year, month, existing);
    await this.adapter.write(`${LEDGER_DIR}/${year}-${month}.md`, content);
    this.app.workspace.trigger("fox-finance:updated");
  }
  /** 删除账本某月的第 index 笔交易（0-based） */
  async deleteTx(year, month, index) {
    const existing = await this.readLedger(year, month);
    if (index < 0 || index >= existing.length)
      throw new Error(`Transaction index ${index} out of range`);
    existing.splice(index, 1);
    const content = this.buildLedgerContent(year, month, existing);
    await this.adapter.write(`${LEDGER_DIR}/${year}-${month}.md`, content);
    this.app.workspace.trigger("fox-finance:updated");
  }
  // ─── Inbox ───────────────────────────────────────
  /** 创建一条暂存箱记录（单文件 YAML frontmatter） */
  async createInboxFile(tx) {
    const now = /* @__PURE__ */ new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    const path = `${INBOX_DIR}/${ts}.md`;
    const data = { ...tx, imported: false };
    if (!data.toAccount)
      data.toAccount = null;
    const yaml = (0, import_obsidian.stringifyYaml)(data);
    const label = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;
    const content = [
      "---",
      yaml.trim(),
      "---",
      "",
      `# ${label}\uFF1A${tx.amount.toFixed(2)}`,
      "",
      `**\u8D26\u6237**\uFF1A${tx.account}${tx.toAccount ? " \u2192 " + tx.toAccount : ""}`,
      `**\u5206\u7C7B**\uFF1A${tx.category} / ${tx.subcategory}`,
      tx.note ? `**\u5907\u6CE8**\uFF1A${tx.note}` : ""
    ].filter(Boolean).join("\n");
    await this.adapter.write(path, content);
    this.app.workspace.trigger("fox-finance:inbox-added");
    return path;
  }
  /** 扫描暂存箱，返回所有未导入的记录 */
  async scanInbox() {
    const results = [];
    try {
      const { files } = await this.adapter.list(INBOX_DIR);
      for (const file of files.filter((f) => f.endsWith(".md")).sort()) {
        const content = await this.adapter.read(file);
        const { frontmatter } = this.parseFrontmatter(content);
        if (!frontmatter || frontmatter.imported)
          continue;
        results.push({
          path: file,
          tx: this.frontmatterToTx(frontmatter)
        });
      }
    } catch (_) {
    }
    return results;
  }
  /** 导入一条暂存箱记录 → 追加到账本，标记已导入 */
  async importInbox(filePath) {
    const content = await this.adapter.read(filePath);
    const { frontmatter, body } = this.parseFrontmatter(content);
    if (!frontmatter)
      throw new Error("Invalid inbox file (no frontmatter)");
    await this.appendToLedger(this.frontmatterToTx(frontmatter));
    frontmatter.imported = true;
    const newYaml = (0, import_obsidian.stringifyYaml)(frontmatter);
    await this.adapter.write(filePath, `---
${newYaml.trim()}
---
${body}`);
    this.app.workspace.trigger("fox-finance:updated");
  }
  // ─── Balances ────────────────────────────────────
  /** 遍历所有账本文件，推算每个账户的当前余额 */
  async calcAccountBalances() {
    const balances = {};
    const { files } = await this.adapter.list(LEDGER_DIR);
    for (const file of files.filter((f) => f.endsWith(".md")).sort()) {
      const txs = await this.readLedgerFile(file);
      for (const tx of txs) {
        this.applyTx(balances, tx);
      }
    }
    return balances;
  }
  // ─── Private: file helpers ───────────────────────
  async readLedgerFile(path) {
    if (!await this.adapter.exists(path))
      return [];
    const content = await this.adapter.read(path);
    const { body } = this.parseFrontmatter(content);
    if (!body)
      return [];
    return this.parseLedgerTable(body);
  }
  parseFrontmatter(content) {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!m)
      return { frontmatter: null, body: content };
    return {
      frontmatter: (0, import_obsidian.parseYaml)(m[1]),
      body: content.slice(m[0].length)
    };
  }
  parseLedgerTable(body) {
    return body.split("\n").filter((l) => l.trim().startsWith("|")).slice(2).map((line) => {
      const c = line.split("|").slice(1, -1).map((s) => s.trim());
      if (c.length < 7)
        return null;
      return {
        date: c[0],
        type: c[1],
        amount: parseFloat(c[2]) || 0,
        account: c[3],
        toAccount: c[4] === "-" ? void 0 : c[4],
        category: c[5],
        subcategory: c[6],
        note: c[7] || "",
        tags: c[8] || ""
        // 向后兼容：旧行无 tags 列
      };
    }).filter((tx) => tx !== null);
  }
  buildLedgerContent(year, month, txs) {
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const yaml = (0, import_obsidian.stringifyYaml)({
      month: `${year}-${month}`,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
      count: txs.length
    });
    const rows = txs.map((t) => {
      const to = t.toAccount || "-";
      const tags = t.tags || "";
      return `| ${t.date} | ${t.type} | ${t.amount.toFixed(2)} | ${t.account} | ${to} | ${t.category} | ${t.subcategory} | ${t.note} | ${tags} |`;
    });
    return [
      "---",
      yaml.trim(),
      "---",
      "",
      "## \u8D26\u672C\u6D41\u6C34",
      "",
      TABLE_HEADER,
      TABLE_SEP,
      ...rows,
      ""
    ].join("\n");
  }
  frontmatterToTx(fm) {
    return {
      date: fm.date || "",
      type: fm.type || "expense",
      amount: Number(fm.amount) || 0,
      account: fm.account || "",
      toAccount: fm.toAccount || void 0,
      category: fm.category || "\u5176\u4ED6",
      subcategory: fm.subcategory || "",
      note: fm.note || "",
      tags: fm.tags || ""
    };
  }
  // ─── Private: balance engine ─────────────────────
  applyTx(b, tx) {
    switch (tx.type) {
      case "income":
        b[tx.account] = (b[tx.account] || 0) + tx.amount;
        break;
      case "expense":
        b[tx.account] = (b[tx.account] || 0) - tx.amount;
        break;
      case "transfer":
      case "investment_in":
        b[tx.account] = (b[tx.account] || 0) - tx.amount;
        if (tx.toAccount) {
          b[tx.toAccount] = (b[tx.toAccount] || 0) + tx.amount;
        }
        break;
      case "investment_return":
        if (tx.toAccount) {
          b[tx.toAccount] = (b[tx.toAccount] || 0) + tx.amount;
        }
        break;
      case "refund":
        b[tx.account] = (b[tx.account] || 0) + tx.amount;
        break;
      case "balance_adjust":
        b[tx.account] = tx.amount;
        break;
    }
  }
};
function round2(n) {
  return Math.round(n * 100) / 100;
}

// finance-modal.ts
var import_obsidian2 = require("obsidian");
var TYPE_OPTIONS = [
  "expense",
  "income",
  "transfer",
  "investment_in",
  "investment_return",
  "refund",
  "balance_adjust"
];
var FoxFinanceModal = class extends import_obsidian2.Modal {
  constructor(app, plugin, onSave, editContext) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.tx = {
      date: "",
      type: "expense",
      amount: 0,
      account: "",
      toAccount: "",
      category: "",
      subcategory: "",
      note: ""
    };
    this.accounts = [];
    this.categories = [];
    this.tagList = [];
    /** 不需要分类的交易类型 */
    this.noCategoryTypes = ["transfer", "investment_in", "investment_return", "balance_adjust"];
    this.dl = new FinanceDataLayer(app);
    if (plugin?.settings) {
      this.accounts = plugin.settings.accounts?.map((a) => a.name) ?? [];
      this.categories = plugin.settings.categories ?? [];
      this.tagList = plugin.settings.tags ?? [];
      if (this.accounts.length)
        this.tx.account = this.accounts[0];
    }
    if (editContext) {
      this.editContext = editContext;
      this.tx = { ...editContext.tx };
    } else {
      const d = /* @__PURE__ */ new Date();
      this.tx.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("fox-finance-modal");
    contentEl.empty();
    const titleText = this.editContext ? "\u270E \u7F16\u8F91\u4EA4\u6613" : "\u2726 \u8BB0\u4E00\u7B14";
    contentEl.createEl("h2", { text: titleText, cls: "fox-finance-modal-title" });
    new import_obsidian2.Setting(contentEl).setName("\u65E5\u671F").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(this.tx.date).onChange((v) => this.tx.date = v);
    });
    new import_obsidian2.Setting(contentEl).setName("\u7C7B\u578B").addDropdown((d) => {
      TYPE_OPTIONS.forEach((t) => d.addOption(t, TRANSACTION_TYPE_LABELS[t]));
      d.setValue(this.tx.type).onChange((v) => {
        this.tx.type = v;
        this.toggleToAccount(v);
        this.toggleCategory(v);
        this.rebuildCategoryDropdown();
        this.rebuildSubcategory();
      });
    });
    new import_obsidian2.Setting(contentEl).setName("\u91D1\u989D").addText((t) => t.setPlaceholder("0.00").setValue(this.tx.amount ? String(this.tx.amount) : "").onChange((v) => {
      this.tx.amount = parseFloat(v) || 0;
    }));
    const accountSetting = new import_obsidian2.Setting(contentEl).setName("\u8D26\u6237").addDropdown((d) => this.buildAccountDropdown(d));
    const toAccountSetting = new import_obsidian2.Setting(contentEl).setName("\u76EE\u6807\u8D26\u6237").addDropdown((d) => this.buildAccountDropdown(d, true));
    if (!["transfer", "investment_in", "investment_return"].includes(this.tx.type)) {
      toAccountSetting.settingEl.addClass("fox-finance-hidden");
    }
    this._toAccountSetting = toAccountSetting;
    const catSetting = new import_obsidian2.Setting(contentEl).setName("\u5206\u7C7B").addDropdown((d) => this.buildCategoryDropdown(d));
    this._catSetting = catSetting;
    const subcatSetting = new import_obsidian2.Setting(contentEl).setName("\u4E8C\u7EA7\u5206\u7C7B").addDropdown((d) => this.buildSubcategoryDropdown(d));
    this._subcatSetting = subcatSetting;
    this.toggleCategory(this.tx.type);
    new import_obsidian2.Setting(contentEl).setName("\u5907\u6CE8").addText((t) => t.setPlaceholder("\u9009\u586B").setValue(this.tx.note).onChange((v) => this.tx.note = v));
    if (this.tagList.length > 0) {
      const tagSetting = new import_obsidian2.Setting(contentEl).setName("\u6807\u7B7E").setDesc("\u70B9\u9009\u5207\u6362");
      const chipContainer = tagSetting.controlEl.createDiv({ cls: "fox-tag-chips" });
      this.renderTagChips(chipContainer);
      this._tagChipsEl = chipContainer;
    }
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText("\u4FDD\u5B58").setCta().onClick(() => this.save()));
  }
  toggleToAccount(type) {
    const show = ["transfer", "investment_in", "investment_return"].includes(type);
    this._toAccountSetting?.settingEl.toggleClass("fox-finance-hidden", !show);
  }
  toggleCategory(type) {
    const hide = this.noCategoryTypes.includes(type);
    this._catSetting?.settingEl.toggleClass("fox-finance-hidden", hide);
    this._subcatSetting?.settingEl.toggleClass("fox-finance-hidden", hide);
  }
  buildAccountDropdown(d, includeEmpty = false) {
    if (includeEmpty)
      d.addOption("", "\u2014");
    if (!this.accounts.length) {
      d.addOption("\u73B0\u91D1", "\u73B0\u91D1");
      d.addOption("\u5FAE\u4FE1", "\u5FAE\u4FE1");
      d.addOption("\u652F\u4ED8\u5B9D", "\u652F\u4ED8\u5B9D");
      d.addOption("\u94F6\u884C\u5361", "\u94F6\u884C\u5361");
      this.accounts = ["\u73B0\u91D1", "\u5FAE\u4FE1", "\u652F\u4ED8\u5B9D", "\u94F6\u884C\u5361"];
    } else {
      this.accounts.forEach((a) => d.addOption(a, a));
    }
    if (includeEmpty) {
      d.setValue("");
    } else {
      d.setValue(this.tx.account || this.accounts[0]);
    }
    d.onChange((v) => {
      if (includeEmpty)
        this.tx.toAccount = v;
      else
        this.tx.account = v;
    });
    return d;
  }
  buildCategoryDropdown(d) {
    const cats = this.categories.filter((c) => {
      if (this.tx.type === "income")
        return c.type === "income";
      if (this.tx.type === "expense")
        return c.type === "expense";
      return true;
    });
    const names = cats.length ? cats.map((c) => c.name) : ["\u9910\u996E", "\u4EA4\u901A", "\u8D2D\u7269", "\u5B66\u4E60", "\u5A31\u4E50", "\u5C45\u4F4F", "\u5DE5\u8D44", "\u5176\u4ED6"];
    names.forEach((n) => d.addOption(n, n));
    d.setValue(this.tx.category || names[0]);
    d.onChange((v) => {
      this.tx.category = v;
      this.rebuildSubcategory();
    });
    return d;
  }
  buildSubcategoryDropdown(d) {
    d.addOption("", "\u2014");
    const cat = this.categories.find((c) => c.name === this.tx.category);
    const subs = cat?.subcategories ?? [];
    subs.forEach((s) => d.addOption(s, s));
    d.setValue(this.tx.subcategory || "");
    d.onChange((v) => this.tx.subcategory = v);
    return d;
  }
  rebuildSubcategory() {
    if (!this._subcatSetting)
      return;
    const setting = this._subcatSetting;
    const dropdownEl = setting.controlEl.querySelector("select");
    if (dropdownEl) {
      dropdownEl.empty();
      const d = { addOption: (v, l) => {
        const o = document.createElement("option");
        o.value = v;
        o.text = l;
        dropdownEl.appendChild(o);
      }, setValue: (v) => {
        dropdownEl.value = v;
      }, onChange: (cb) => {
        dropdownEl.onchange = () => cb(dropdownEl.value);
      } };
      this.buildSubcategoryDropdown(d);
    }
  }
  rebuildCategoryDropdown() {
    if (!this._catSetting)
      return;
    const setting = this._catSetting;
    const dropdownEl = setting.controlEl.querySelector("select");
    if (dropdownEl) {
      const cats = this.categories.filter((c) => {
        if (this.tx.type === "income")
          return c.type === "income";
        if (this.tx.type === "expense")
          return c.type === "expense";
        return true;
      });
      const names = cats.map((c) => c.name);
      if (!names.includes(this.tx.category)) {
        this.tx.category = names[0] || "";
      }
      dropdownEl.empty();
      const d = { addOption: (v, l) => {
        const o = document.createElement("option");
        o.value = v;
        o.text = l;
        dropdownEl.appendChild(o);
      }, setValue: (v) => {
        dropdownEl.value = v;
      }, onChange: (cb) => {
        dropdownEl.onchange = () => cb(dropdownEl.value);
      } };
      this.buildCategoryDropdown(d);
    }
  }
  // ─── Tags ────────────────────────────────────────────
  /** 当前选中的标签集合 */
  get selectedTags() {
    return new Set(this.tx.tags ? this.tx.tags.split(",").map((s) => s.trim()).filter(Boolean) : []);
  }
  renderTagChips(container) {
    container.empty();
    const selected = this.selectedTags;
    for (const tag of this.tagList) {
      const chip = container.createEl("span", {
        cls: `fox-tag-chip${selected.has(tag) ? " fox-tag-chip-active" : ""}`,
        text: tag
      });
      chip.onclick = () => {
        chip.classList.toggle("fox-tag-chip-active");
        this.syncTagsFromChips(container);
      };
    }
  }
  syncTagsFromChips(container) {
    const chips = container.querySelectorAll(".fox-tag-chip");
    const active = [];
    chips.forEach((chip) => {
      if (chip.classList.contains("fox-tag-chip-active")) {
        active.push(chip.textContent || "");
      }
    });
    this.tx.tags = active.join(", ");
  }
  async save() {
    if (!this.tx.date) {
      new import_obsidian2.Notice("\u8BF7\u586B\u5199\u65E5\u671F");
      return;
    }
    if (!this.tx.amount || this.tx.amount <= 0) {
      new import_obsidian2.Notice("\u8BF7\u586B\u5199\u6709\u6548\u91D1\u989D");
      return;
    }
    if (this.noCategoryTypes.includes(this.tx.type)) {
      this.tx.category = "\u5176\u4ED6";
      this.tx.subcategory = "";
    }
    try {
      if (this.editContext) {
        await this.dl.updateTx(this.editContext.year, this.editContext.month, this.editContext.index, this.tx);
        new import_obsidian2.Notice("\u2705 \u5DF2\u66F4\u65B0");
      } else {
        await this.dl.appendToLedger(this.tx);
        new import_obsidian2.Notice("\u2705 \u5DF2\u4FDD\u5B58");
      }
      this.onSave?.();
      this.close();
    } catch (e) {
      new import_obsidian2.Notice("\u274C \u4FDD\u5B58\u5931\u8D25\uFF1A" + e.message);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};

// finance-view.ts
var import_obsidian6 = require("obsidian");

// finance-tx-modal.ts
var import_obsidian3 = require("obsidian");
var FoxFinanceTxModal = class extends import_obsidian3.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.entries = [];
    this.filtered = [];
    this.filterType = "all";
    this.filterAccount = "all";
    this.filterTag = "all";
    this.accounts = [];
    this.typeOptions = [];
    this.tagOptions = [];
    this.dl = new FinanceDataLayer(app);
    const d = /* @__PURE__ */ new Date();
    this.year = d.getFullYear();
    this.month = d.getMonth() + 1;
    this.accounts = plugin.settings.accounts?.map((a) => a.name) ?? [];
    this.typeOptions = [
      { value: "all", label: "\u5168\u90E8\u7C7B\u578B" },
      ...Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))
    ];
    const tags = plugin.settings.tags ?? [];
    this.tagOptions = [
      { value: "all", label: "\u5168\u90E8\u6807\u7B7E" },
      ...tags.map((t) => ({ value: t, label: t })),
      { value: "none", label: "\u65E0\u6807\u7B7E" }
    ];
  }
  onOpen() {
    this.modalEl.addClass("fox-finance-modal", "fox-tx-modal");
    this.loadAndRender();
  }
  async loadAndRender() {
    const txs = await this.dl.readLedger(this.year, this.month);
    this.entries = txs.map((tx, i) => ({ tx, originalIndex: i }));
    this.applyFilters();
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "fox-tx-header" });
    header.createEl("span", { cls: "fox-tx-title", text: "\u2726 \u6D41\u6C34\u660E\u7EC6" });
    const nav = header.createDiv({ cls: "fox-tx-nav" });
    const prevBtn = nav.createEl("button", { cls: "fox-tx-nav-btn", text: "\u2039" });
    nav.createEl("span", { cls: "fox-tx-nav-month", text: `${this.year}-${String(this.month).padStart(2, "0")}` });
    const nextBtn = nav.createEl("button", { cls: "fox-tx-nav-btn", text: "\u203A" });
    prevBtn.onclick = () => {
      this.month--;
      if (this.month < 1) {
        this.month = 12;
        this.year--;
      }
      this.loadAndRender();
    };
    nextBtn.onclick = () => {
      this.month++;
      if (this.month > 12) {
        this.month = 1;
        this.year++;
      }
      this.loadAndRender();
    };
    const income = this.filtered.filter((e) => e.tx.type === "income").reduce((s, e) => s + e.tx.amount, 0);
    const expense = this.filtered.filter((e) => e.tx.type === "expense").reduce((s, e) => s + e.tx.amount, 0);
    const net = income - expense;
    const summary = contentEl.createDiv({ cls: "fox-tx-summary" });
    summary.createSpan({ cls: "fox-tx-summary-income", text: `\u{1F4C8} \u6536\u5165  \xA5${income.toFixed(2)}` });
    summary.createSpan({ cls: "fox-tx-summary-expense", text: `\u{1F4C9} \u652F\u51FA  \xA5${expense.toFixed(2)}` });
    summary.createSpan({ cls: `fox-tx-summary-net ${net >= 0 ? "positive" : "negative"}`, text: `\u{1F4CA} \u7ED3\u4F59  \xA5${net.toFixed(2)}` });
    const filters = contentEl.createDiv({ cls: "fox-tx-filters" });
    this.buildDropdown(filters, this.filterType, this.typeOptions, (v) => {
      this.filterType = v;
      this.applyFilters();
      this.render();
    });
    this.buildDropdown(
      filters,
      this.filterAccount,
      [{ value: "all", label: "\u5168\u90E8\u8D26\u6237" }, ...this.accounts.map((a) => ({ value: a, label: a }))],
      (v) => {
        this.filterAccount = v;
        this.applyFilters();
        this.render();
      }
    );
    this.buildDropdown(filters, this.filterTag, this.tagOptions, (v) => {
      this.filterTag = v;
      this.applyFilters();
      this.render();
    });
    const table = contentEl.createDiv({ cls: "fox-tx-table" });
    if (this.filtered.length === 0) {
      table.createDiv({ cls: "fox-tx-empty", text: "\u6CA1\u6709\u5339\u914D\u7684\u6D41\u6C34\u8BB0\u5F55" });
    } else {
      const groups = this.groupByDate(this.filtered);
      for (const [groupLabel, rows] of groups) {
        table.createDiv({ cls: "fox-tx-group-header", text: groupLabel });
        for (const entry of rows) {
          const row = table.createDiv({ cls: "fox-tx-modal-row" });
          const { tx, originalIndex } = entry;
          const isNeg = tx.type === "expense" || tx.type === "transfer" || tx.type === "investment_in";
          row.createSpan({ cls: "fox-tx-col-date", text: tx.date.slice(5) });
          row.createSpan({ cls: `fox-tx-col-type fox-tx-type-${tx.type}`, text: TRANSACTION_TYPE_LABELS[tx.type] || tx.type });
          row.createSpan({ cls: "fox-tx-col-cat", text: `${tx.category}${tx.subcategory ? "/" + tx.subcategory : ""}` });
          row.createSpan({ cls: "fox-tx-col-acct", text: tx.account });
          const amtEl = row.createSpan({ cls: `fox-tx-col-amt ${isNeg ? "negative" : "positive"}`, text: `${isNeg ? "-" : "+"}${tx.amount.toFixed(2)}` });
          if (tx.toAccount)
            amtEl.title = `\u2192 ${tx.toAccount}`;
          const note = tx.note?.trim();
          const hasNote = !!note;
          const tags = tx.tags ? tx.tags.split(",").map((s) => s.trim()).filter(Boolean) : [];
          const noteCol = row.createSpan({ cls: "fox-tx-col-note" });
          if (hasNote) {
            const noteText = noteCol.createSpan({ cls: "fox-tx-note-text", text: note });
          }
          if (tags.length > 0) {
            tags.forEach((t) => {
              noteCol.createSpan({ cls: "fox-tx-tag", text: t });
            });
          }
          const actions = row.createDiv({ cls: "fox-tx-actions" });
          const editBtn = actions.createEl("button", { cls: "fox-tx-action-btn fox-tx-action-edit", text: "\u270E" });
          editBtn.title = "\u7F16\u8F91";
          editBtn.onclick = (e) => {
            e.stopPropagation();
            this.editTx(entry);
          };
          const delBtn = actions.createEl("button", { cls: "fox-tx-action-btn fox-tx-action-del", text: "\u2715" });
          delBtn.title = "\u5220\u9664";
          delBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteTx(entry);
          };
        }
      }
    }
  }
  // ─── 编辑 ──────────────────────────────────────────────
  editTx(entry) {
    const editCtx = {
      year: String(this.year),
      month: String(this.month).padStart(2, "0"),
      index: entry.originalIndex,
      tx: { ...entry.tx }
    };
    new FoxFinanceModal(this.app, this.plugin, () => this.loadAndRender(), editCtx).open();
  }
  // ─── 删除 ──────────────────────────────────────────────
  async deleteTx(entry) {
    const confirmed = confirm(`\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u7B14\u4EA4\u6613\u5417\uFF1F

${entry.tx.date}  ${TRANSACTION_TYPE_LABELS[entry.tx.type]}  \xA5${entry.tx.amount.toFixed(2)}  ${entry.tx.note || ""}`);
    if (!confirmed)
      return;
    try {
      await this.dl.deleteTx(
        String(this.year),
        String(this.month).padStart(2, "0"),
        entry.originalIndex
      );
      new import_obsidian3.Notice("\u{1F5D1}\uFE0F \u5DF2\u5220\u9664");
      await this.loadAndRender();
    } catch (e) {
      new import_obsidian3.Notice("\u274C \u5220\u9664\u5931\u8D25\uFF1A" + e.message);
    }
  }
  // ─── Helpers ──────────────────────────────────────────
  buildDropdown(parent, _current, options, onChange) {
    const sel = parent.createEl("select", { cls: "fox-tx-filter-select" });
    options.forEach((o) => {
      const opt = sel.createEl("option");
      opt.value = o.value;
      opt.text = o.label;
      if (o.value === _current)
        opt.selected = true;
    });
    sel.onchange = () => onChange(sel.value);
  }
  applyFilters() {
    this.filtered = this.entries.filter((e) => {
      if (this.filterType !== "all" && e.tx.type !== this.filterType)
        return false;
      if (this.filterAccount !== "all" && e.tx.account !== this.filterAccount)
        return false;
      if (this.filterTag !== "all") {
        const txTags = e.tx.tags ? e.tx.tags.split(",").map((s) => s.trim()).filter(Boolean) : [];
        if (this.filterTag === "none") {
          if (txTags.length > 0)
            return false;
        } else {
          if (!txTags.includes(this.filterTag))
            return false;
        }
      }
      return true;
    });
  }
  /** 按日期分组，倒序排列 */
  groupByDate(txs) {
    const map = /* @__PURE__ */ new Map();
    for (const entry of txs) {
      if (!map.has(entry.tx.date))
        map.set(entry.tx.date, []);
      map.get(entry.tx.date).push(entry);
    }
    const todayStr = this.dateStr(/* @__PURE__ */ new Date());
    const yesterdayStr = this.dateStr(new Date(Date.now() - 864e5));
    const result = [];
    const sorted = [...map.keys()].sort().reverse();
    for (const d of sorted) {
      let label;
      if (d === todayStr)
        label = "\u4ECA \u5929";
      else if (d === yesterdayStr)
        label = "\u6628 \u5929";
      else
        label = d.slice(5);
      result.push([label, map.get(d)]);
    }
    return result;
  }
  dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  onClose() {
    this.contentEl.empty();
  }
};

// finance-adjust-modal.ts
var import_obsidian4 = require("obsidian");
var FoxFinanceAdjustModal = class extends import_obsidian4.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.selectedAccount = "";
    this.currentBalance = 0;
    this.newBalanceStr = "";
    this.note = "";
    this.dl = new FinanceDataLayer(app);
    const accounts = plugin.settings?.accounts ?? [];
    if (accounts.length)
      this.selectedAccount = accounts[0].name;
  }
  onOpen() {
    this.modalEl.addClass("fox-finance-modal", "fox-adjust-modal");
    this.loadBalance();
  }
  async loadBalance() {
    const all = await this.dl.calcAccountBalances();
    this.currentBalance = all[this.selectedAccount] ?? 0;
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { cls: "fox-finance-modal-title", text: "\u2726 \u8D44\u4EA7\u66F4\u65B0" });
    const accountSetting = contentEl.createDiv({ cls: "fox-adjust-field" });
    accountSetting.createSpan({ cls: "fox-adjust-label", text: "\u8D26\u6237" });
    const sel = accountSetting.createEl("select", { cls: "fox-adjust-select" });
    const accounts = this.plugin.settings?.accounts ?? [];
    (accounts.length ? accounts : [{ name: "\u5FAE\u4FE1" }, { name: "\u652F\u4ED8\u5B9D" }, { name: "\u94F6\u884C\u5361" }]).forEach((a) => {
      const opt = sel.createEl("option");
      opt.value = a.name;
      opt.text = a.name;
      if (a.name === this.selectedAccount)
        opt.selected = true;
    });
    sel.onchange = async () => {
      this.selectedAccount = sel.value;
      const all = await this.dl.calcAccountBalances();
      this.currentBalance = all[this.selectedAccount] ?? 0;
      this.render();
    };
    const currentRow = contentEl.createDiv({ cls: "fox-adjust-field" });
    currentRow.createSpan({ cls: "fox-adjust-label", text: "\u5F53\u524D\u4F59\u989D" });
    currentRow.createSpan({ cls: "fox-adjust-current", text: `\xA5${this.currentBalance.toFixed(2)}` });
    const newRow = contentEl.createDiv({ cls: "fox-adjust-field" });
    newRow.createSpan({ cls: "fox-adjust-label", text: "\u6700\u65B0\u4F59\u989D" });
    const input = newRow.createEl("input", { cls: "fox-adjust-input", attr: { type: "number", step: "0.01", placeholder: "0.00" } });
    if (this.newBalanceStr)
      input.value = this.newBalanceStr;
    input.oninput = () => {
      this.newBalanceStr = input.value;
    };
    input.focus();
    const noteRow = contentEl.createDiv({ cls: "fox-adjust-field" });
    noteRow.createSpan({ cls: "fox-adjust-label", text: "\u5907\u6CE8" });
    const noteInput = noteRow.createEl("input", { cls: "fox-adjust-input", attr: { placeholder: "\u9009\u586B\uFF08\u5982\uFF1A\u5BF9\u8D26\u4FEE\u6B63\uFF09" } });
    if (this.note)
      noteInput.value = this.note;
    noteInput.oninput = () => {
      this.note = noteInput.value;
    };
    const btnRow = contentEl.createDiv({ cls: "fox-adjust-actions" });
    const cancelBtn = btnRow.createEl("button", { cls: "fox-adjust-btn", text: "\u53D6\u6D88" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = btnRow.createEl("button", { cls: "fox-adjust-btn fox-adjust-btn-primary", text: "\u66F4\u65B0" });
    saveBtn.onclick = () => this.save();
  }
  async save() {
    const amount = parseFloat(this.newBalanceStr);
    if (isNaN(amount) || amount < 0) {
      new import_obsidian4.Notice("\u8BF7\u586B\u5199\u6709\u6548\u7684\u4F59\u989D");
      return;
    }
    const d = /* @__PURE__ */ new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await this.dl.appendToLedger({
      date: dateStr,
      type: "balance_adjust",
      amount,
      account: this.selectedAccount,
      category: "\u5176\u4ED6",
      subcategory: "",
      note: this.note || `\u4F59\u989D\u8C03\u6574\uFF1A\xA5${amount.toFixed(2)}`
    });
    new import_obsidian4.Notice(`\u2705 ${this.selectedAccount} \u4F59\u989D\u5DF2\u66F4\u65B0\u4E3A \xA5${amount.toFixed(2)}`);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// finance-cash-modal.ts
var import_obsidian5 = require("obsidian");
var FoxFinanceCashModal = class extends import_obsidian5.Modal {
  constructor(app, plugin, balances) {
    super(app);
    this.plugin = plugin;
    this.balances = balances;
  }
  onOpen() {
    this.modalEl.addClass("fox-finance-modal", "fox-cash-modal");
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const titleRow = contentEl.createDiv({ cls: "fox-cash-title-row" });
    titleRow.createEl("span", { cls: "fox-cash-title-icon", text: "\u{1F4D6}" });
    titleRow.createEl("span", { cls: "fox-cash-title", text: "\u73B0\u91D1\u6D41\u6863\u6848" });
    titleRow.createEl("span", { cls: "fox-cash-subtitle", text: "\u6240\u6709\u73B0\u91D1\u8D26\u6237\u4E00\u89C8" });
    const accounts = this.plugin.settings?.accounts ?? [];
    const cashAccounts = accounts.filter((a) => a.type === "cash");
    const totalBalance = cashAccounts.reduce((s, a) => s + (this.balances[a.name] ?? 0), 0);
    const positiveAccounts = cashAccounts.filter((a) => (this.balances[a.name] ?? 0) > 0).length;
    const statRow = contentEl.createDiv({ cls: "fox-cash-stat-row" });
    const totalStat = statRow.createDiv({ cls: "fox-cash-stat" });
    totalStat.createEl("span", { cls: "fox-cash-stat-label", text: "\u603B\u4F59\u989D" });
    totalStat.createEl("span", { cls: "fox-cash-stat-value", text: `\xA5${totalBalance.toFixed(2)}` });
    const countStat = statRow.createDiv({ cls: "fox-cash-stat" });
    countStat.createEl("span", { cls: "fox-cash-stat-label", text: "\u8D26\u6237\u6570" });
    countStat.createEl("span", { cls: "fox-cash-stat-value fox-cash-stat-count", text: `${cashAccounts.length}` });
    const activeStat = statRow.createDiv({ cls: "fox-cash-stat" });
    activeStat.createEl("span", { cls: "fox-cash-stat-label", text: "\u6709\u4F59\u989D" });
    activeStat.createEl("span", { cls: "fox-cash-stat-value fox-cash-stat-active", text: `${positiveAccounts}` });
    if (cashAccounts.length === 0) {
      const empty = contentEl.createDiv({ cls: "fox-cash-empty" });
      empty.createEl("span", { cls: "fox-cash-empty-icon", text: "\u{1F331}" });
      empty.createEl("span", { text: "\u8FD8\u6CA1\u6709\u73B0\u91D1\u8D26\u6237\uFF0C\u5148\u53BB\u8BBE\u7F6E\u9875\u6DFB\u52A0\u5427" });
    } else {
      const list = contentEl.createDiv({ cls: "fox-cash-list" });
      for (const acc of cashAccounts) {
        const bal = this.balances[acc.name] ?? 0;
        const row = list.createDiv({ cls: "fox-cash-item" });
        row.createEl("span", { cls: "fox-cash-item-dot", text: "\u25CF" });
        row.createEl("span", { cls: "fox-cash-item-name", text: acc.name });
        const amtEl = row.createEl("span", { cls: `fox-cash-item-amt${bal >= 0 ? "" : " negative"}` });
        amtEl.textContent = `\xA5${bal.toFixed(2)}`;
      }
    }
    const footer = contentEl.createDiv({ cls: "fox-cash-footer" });
    const closeBtn = footer.createEl("button", { cls: "fox-cash-close-btn", text: "\u5173\u95ED" });
    closeBtn.onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// finance-view.ts
var VIEW_TYPE_FOX_FINANCE = "fox-finance-dashboard";
var FoxFinanceView = class extends import_obsidian6.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.txs = [];
    this.balances = {};
    this.yearlySpending = {};
    this.bgUrl = "";
    this.loadedIcons = false;
    // 图标 URL 缓存（从插件异步加载后缓存）
    this.iconUrls = {};
    this.dl = new FinanceDataLayer(this.app);
  }
  getViewType() {
    return VIEW_TYPE_FOX_FINANCE;
  }
  getDisplayText() {
    return "\u72D0\u306E\u8D22\u5BCC\u68EE\u6797";
  }
  getIcon() {
    return "wallet";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("fox-finance-view");
    this.registerEvent(
      this.app.workspace.on("fox-finance:updated", () => this.refresh())
    );
    await this.refresh();
    this.loadedIcons = true;
  }
  async refresh() {
    const container = this.containerEl.children[1];
    if (!container)
      return;
    const iconNames = [
      "\u661F\u7A7A\u4E4B\u72FC.png",
      "\u5E7C\u82D7.png",
      "\u8D22\u5BCC\u6811.png",
      "\u661F\u8FB0\u6C34\u6676\u7403.png",
      "\u8D22\u5BCC\u5706\u76D8.png",
      "\u94F6\u6CB3\u73BB\u7483\u74F6.png",
      "\u7FBD\u6BDB\u8D26\u672C.png",
      "\u661F\u6CB3\u5C0F\u8DEF.png",
      "\u63D0\u706F.png",
      "\u661F\u7A7A\u65E5\u5386.png",
      "\u72FC\u5FBD\u76FE\u724C.png"
    ];
    await Promise.all(iconNames.map(async (name) => {
      if (!this.iconUrls[name]) {
        this.iconUrls[name] = await this.plugin.getIconUrl(name);
      }
    }));
    await this.loadData();
    this.bgUrl = await this.plugin.getRandomBgUrl();
    this.render();
    this.loadedIcons = true;
  }
  async loadData() {
    const d = /* @__PURE__ */ new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    this.txs = await this.dl.readLedger(y, m);
    this.balances = await this.dl.calcAccountBalances();
    this.yearlySpending = {};
    for (let mo = 1; mo <= 12; mo++) {
      const monthTxs = await this.dl.readLedger(y, mo);
      for (const tx of monthTxs) {
        if (tx.type === "expense") {
          this.yearlySpending[tx.category] = (this.yearlySpending[tx.category] || 0) + tx.amount;
        }
      }
    }
  }
  applyBg(container) {
    if (this.bgUrl) {
      container.style.backgroundImage = `url(${this.bgUrl})`;
      container.style.backgroundSize = "cover";
      container.style.backgroundPosition = "center";
      container.style.backgroundAttachment = "fixed";
    }
  }
  // ========================
  // RENDER
  // ========================
  render() {
    const container = this.containerEl.children[1];
    container.empty();
    this.applyBg(container);
    const topBar = container.createEl("div", { cls: "fox-top-bar" });
    const logo = topBar.createEl("div", { cls: "fox-logo-group" });
    this.addIconImg(logo, "\u661F\u7A7A\u4E4B\u72FC.png", "fox-logo-icon");
    logo.createEl("span", { cls: "fox-logo", text: "\u72D0\u306E\u8D22\u5BCC\u68EE\u6797" });
    topBar.createEl("span", { cls: "fox-mode-pill", text: "\u6708\u5EA6\u89C6\u56FE" });
    const bal = this.calcNetAsset();
    const levelText = bal > 5e4 ? "\u{1F333} Lv.3" : bal > 1e4 ? "\u{1F331} Lv.2" : "\u{1F330} Lv.1";
    const levelPill = topBar.createEl("span", { cls: "fox-level-pill" });
    this.addIconImg(levelPill, "\u72FC\u5FBD\u76FE\u724C.png", "fox-level-icon");
    levelPill.append(levelText);
    topBar.createEl("span", { cls: "fox-star-btn", text: "\u2605" });
    const starBtn = topBar.querySelector(".fox-star-btn");
    if (starBtn) {
      starBtn.onclick = () => {
        container.classList.toggle("fox-amounts-hidden");
        starBtn.classList.toggle("fox-star-active");
      };
    }
    const sectionLabel = (parent, text) => parent.createEl("div", { cls: "fox-section-label", text });
    sectionLabel(container, "\u8D44 \u4EA7 \u661F \u56FE");
    const cardsRow = container.createEl("div", { cls: "fox-cards-row" });
    this.buildCard(cardsRow, "\u73B0\u91D1\u6D41", "cash", "\u5E7C\u82D7.png", () => {
      const cashNames = new Set((this.plugin.settings?.accounts ?? []).filter((a) => a.type === "cash").map((a) => a.name));
      return Object.entries(this.balances).filter(([name, v]) => cashNames.has(name) && v > 0).slice(0, 3);
    });
    const cashCard = cardsRow.querySelector(".fox-card-cash");
    if (cashCard) {
      cashCard.style.cursor = "pointer";
      cashCard.onclick = () => new FoxFinanceCashModal(this.app, this.plugin, this.balances).open();
    }
    this.buildCard(cardsRow, "\u6295\u8D44\u8D44\u4EA7", "invest", "\u8D22\u5BCC\u6811.png", () => []);
    this.buildCenterCard(cardsRow);
    this.buildCard(cardsRow, "\u672C\u6708\u9884\u7B97", "budget", "\u8D22\u5BCC\u5706\u76D8.png", () => []);
    this.buildCard(cardsRow, "\u5E74\u5EA6\u9884\u7B97", "budget-yearly", "\u94F6\u6CB3\u73BB\u7483\u74F6.png", () => []);
    this.buildCard(cardsRow, "\u6210\u957F\u6295\u5165", "growth", "\u94F6\u6CB3\u73BB\u7483\u74F6.png", () => []);
    sectionLabel(container, "\u5FEB \u901F \u64CD \u4F5C");
    const actionsBar = container.createEl("div", { cls: "fox-actions-bar" });
    this.buildActionBtn(actionsBar, "\uFF0B \u8BB0\u4E00\u7B14", "\u7FBD\u6BDB\u8D26\u672C.png", true, () => {
      this.app.workspace.trigger("fox-finance:quick-add");
    });
    this.buildActionBtn(actionsBar, "\u67E5\u770B\u6D41\u6C34", "\u661F\u6CB3\u5C0F\u8DEF.png", false, () => {
      new FoxFinanceTxModal(this.app, this.plugin).open();
    });
    this.buildActionBtn(actionsBar, "\u8D44\u4EA7\u66F4\u65B0", "\u63D0\u706F.png", false, () => {
      new FoxFinanceAdjustModal(this.app, this.plugin).open();
    });
    this.buildActionBtn(actionsBar, "\u5E74\u8F6E", "\u661F\u7A7A\u65E5\u5386.png", false, () => {
      this.app.workspace.trigger("fox-finance:open-review");
    });
    this.buildActionBtn(actionsBar, "\u{1F4E5} \u5237\u65B0", "", false, () => this.refresh());
    sectionLabel(container, "\u8FD1 \u671F \u6D41 \u6C34");
    const txPanel = container.createEl("div", { cls: "fox-tx-panel" });
    const headerRow = txPanel.createEl("div", { cls: "fox-tx-header" });
    ["\u65E5\u671F", "\u7C7B\u578B", "\u91D1\u989D", "\u8D26\u6237", "\u5206\u7C7B", "\u5907\u6CE8"].forEach((h) => {
      headerRow.createEl("span", { cls: "fox-tx-cell", text: h });
    });
    const recent = this.txs.slice(-10).reverse();
    if (recent.length === 0) {
      txPanel.createEl("div", { cls: "fox-tx-empty", text: "\u672C\u6708\u8FD8\u6CA1\u6709\u6D41\u6C34\u8BB0\u5F55\uFF0C\u70B9\u51FB\u4E0A\u65B9\u300C\uFF0B \u8BB0\u4E00\u7B14\u300D\u5F00\u59CB\u8BB0\u8D26\u5427 \u2728" });
    } else {
      recent.forEach((tx) => {
        const row = txPanel.createEl("div", { cls: "fox-tx-row" });
        const isNeg = tx.type === "expense" || tx.type === "transfer" || tx.type === "investment_in";
        row.createEl("span", { cls: "fox-tx-cell", text: tx.date.slice(5) });
        row.createEl("span", { cls: `fox-tx-cell fox-tx-type-${tx.type}`, text: TRANSACTION_TYPE_LABELS[tx.type] || tx.type });
        row.createEl("span", { cls: `fox-tx-cell fox-tx-amount ${isNeg ? "negative" : "positive"}`, text: isNeg ? `-${tx.amount.toFixed(2)}` : `+${tx.amount.toFixed(2)}` });
        row.createEl("span", { cls: "fox-tx-cell", text: tx.account });
        row.createEl("span", { cls: "fox-tx-cell", text: tx.category });
        row.createEl("span", { cls: "fox-tx-cell fox-tx-note", text: tx.note || "-" });
      });
    }
    const footer = container.createEl("div", { cls: "fox-footer-bar" });
    const tabs = ["\u8D22\u5BCC\u89C2\u6D4B\u53F0", "\u6D41\u6C34\u660E\u7EC6", "\u8D26\u6237\u7BA1\u7406", "\u5E74\u8F6E", "\u68EE\u6797\xB7\u7814\u7A76\u5BA4"];
    tabs.forEach((t, i) => {
      const el = footer.createEl("span", {
        cls: i === 0 ? "fox-footer-tab fox-footer-tab-active" : "fox-footer-tab",
        text: t
      });
      if (i === 1)
        el.onclick = () => new FoxFinanceTxModal(this.app, this.plugin).open();
      if (i === 2)
        el.onclick = () => this.app.workspace.trigger("fox-finance:open-settings");
      if (i === 3)
        el.onclick = () => this.app.workspace.trigger("fox-finance:open-review");
    });
    this.addIconImg(footer, "\u661F\u7A7A\u4E4B\u72FC.png", "fox-footer-wolf");
  }
  // ─── Card builders ──────────────────────────────
  buildCard(parent, title, type, iconFile, detailFn) {
    const card = parent.createEl("div", { cls: `fox-card fox-card-${type}` });
    const titleRow = card.createEl("div", { cls: "fox-card-title-row" });
    this.addIconImg(titleRow, iconFile, "fox-card-icon");
    titleRow.createEl("span", { cls: "fox-card-title", text: title });
    const details = detailFn(this.balances);
    if (type === "budget") {
      const monthly = (this.plugin.settings?.budgets ?? []).filter((b) => b.period === "monthly");
      const total2 = monthly.reduce((s, b) => s + b.amount, 0);
      const spent = this.txs.filter((t) => t.type === "expense" && monthly.some((b) => b.category === t.category)).reduce((s, t) => s + t.amount, 0);
      const pct = total2 > 0 ? Math.round(spent / total2 * 100) : 0;
      card.createEl("div", { cls: `fox-card-amount fox-amount-budget`, text: `\xA5${total2.toFixed(2)}` });
      card.createEl("div", { cls: "fox-card-detail", text: `\u5DF2\u7528 ${pct}%` });
      const bar = card.createEl("div", { cls: "fox-progress-bar" });
      bar.createEl("div", { cls: "fox-progress-fill", attr: { style: `width: ${Math.min(pct, 100)}%` } });
      return;
    }
    if (type === "budget-yearly") {
      const yearly = (this.plugin.settings?.budgets ?? []).filter((b) => b.period === "yearly");
      const total2 = yearly.reduce((s, b) => s + b.amount, 0);
      const spent = yearly.reduce((s, b) => s + (this.yearlySpending[b.category] || 0), 0);
      const pct = total2 > 0 ? Math.round(spent / total2 * 100) : 0;
      card.createEl("div", { cls: `fox-card-amount fox-amount-budget`, text: `\xA5${total2.toFixed(2)}` });
      card.createEl("div", { cls: "fox-card-detail", text: `\u5DF2\u7528 ${pct}%` });
      const bar = card.createEl("div", { cls: "fox-progress-bar" });
      bar.createEl("div", { cls: "fox-progress-fill", attr: { style: `width: ${Math.min(pct, 100)}%` } });
      if (spent > 0) {
        card.createEl("div", { cls: "fox-card-change", text: `\u5DF2\u82B1 \xA5${spent.toFixed(2)}` });
      }
      return;
    }
    if (type === "growth") {
      const growth = this.txs.filter((t) => t.category === "\u5B66\u4E60").reduce((s, t) => s + t.amount, 0);
      card.createEl("div", { cls: `fox-card-amount fox-amount-growth`, text: `\xA5${growth.toFixed(2)}` });
      if (details.length) {
        const detailEl = card.createEl("div", { cls: "fox-card-detail" });
        details.forEach(([name, val]) => {
          detailEl.createEl("div", { cls: "fox-detail-item", text: `${name}  ${val.toFixed(2)}` });
        });
      }
      return;
    }
    let total = 0;
    if (details.length) {
      total = details.reduce((s, [_, v]) => s + v, 0);
    } else if (type === "invest") {
      for (const [acct, bal] of Object.entries(this.balances)) {
        if (["\u6708\u6708\u5B9D", "\u5B63\u5B63\u5B9D", "\u57FA\u91D1", "\u80A1\u7968"].some((k) => acct.includes(k))) {
          total += bal;
        }
      }
    }
    card.createEl("div", { cls: `fox-card-amount fox-amount-${type}`, text: `\xA5${total.toFixed(2)}` });
    if (details.length) {
      const detailEl = card.createEl("div", { cls: "fox-card-detail" });
      details.forEach(([name, val]) => {
        detailEl.createEl("div", { cls: "fox-detail-item", text: `${name}  ${val.toFixed(2)}` });
      });
    }
  }
  buildCenterCard(parent) {
    const card = parent.createEl("div", { cls: "fox-card fox-card-center" });
    const titleRow = card.createEl("div", { cls: "fox-card-title-row" });
    this.addIconImg(titleRow, "\u661F\u8FB0\u6C34\u6676\u7403.png", "fox-card-icon");
    titleRow.createEl("span", { cls: "fox-card-title", text: "\u5F53\u524D\u51C0\u8D44\u4EA7" });
    const net = this.calcNetAsset();
    card.createEl("div", { cls: "fox-card-amount fox-amount-center", text: `\xA5${net.toFixed(2)}` });
    card.createEl("div", { cls: "fox-card-change", text: `\u5F53\u524D\u51C0\u503C` });
  }
  buildActionBtn(parent, label, iconFile, primary, onClick) {
    const btn = parent.createEl("button", { cls: `fox-btn ${primary ? "fox-btn-primary" : ""}` });
    if (iconFile && this.iconUrls[iconFile]) {
      this.addIconImg(btn, iconFile, "fox-btn-icon");
    }
    btn.createEl("span", { text: label });
    btn.onclick = onClick;
  }
  // ─── Icon helper ──────────────────────────────
  addIconImg(parent, filename, cls) {
    const url = this.iconUrls[filename];
    if (!url)
      return;
    const img = parent.createEl("img", { cls });
    img.src = url;
    img.alt = filename.replace(".png", "");
  }
  calcNetAsset() {
    return Object.values(this.balances).reduce((s, v) => s + v, 0);
  }
};

// finance-review-view.ts
var import_obsidian7 = require("obsidian");
var VIEW_TYPE_FOX_REVIEW = "fox-finance-review";
var PIE_COLORS = ["#a78bfa", "#34d399", "#f87171", "#f59e0b", "#60a5fa", "#f472b6", "#2dd4bf", "#fb923c", "#e879f9", "#22d3ee"];
var FoxFinanceReviewView = class extends import_obsidian7.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.txs = [];
    this.balances = {};
    this.bgUrl = "";
    this._yearlyTxs = null;
    this._yearlyYear = null;
    this.dl = new FinanceDataLayer(this.app);
    const d = /* @__PURE__ */ new Date();
    this.year = d.getFullYear();
    this.month = d.getMonth() + 1;
  }
  getViewType() {
    return VIEW_TYPE_FOX_REVIEW;
  }
  getDisplayText() {
    return "\u72D0\u306E\u5E74\u8F6E";
  }
  getIcon() {
    return "calendar";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("fox-finance-view", "fox-review-view");
    this.registerEvent(
      this.app.workspace.on("fox-finance:updated", () => this.refresh())
    );
    await this.refresh();
  }
  async refresh() {
    const container = this.containerEl.children[1];
    if (!container)
      return;
    await this.loadData();
    this.bgUrl = await this.plugin.getRandomBgUrl();
    this.render();
  }
  async loadData() {
    this.txs = await this.dl.readLedger(this.year, this.month);
    this.balances = await this.dl.calcAccountBalances();
    if (!this._yearlyTxs || this._yearlyYear !== this.year) {
      this._yearlyTxs = [];
      for (let mo = 1; mo <= 12; mo++) {
        const mt = await this.dl.readLedger(this.year, mo);
        this._yearlyTxs.push(...mt);
      }
      this._yearlyYear = this.year;
    }
  }
  applyBg(container) {
    if (this.bgUrl) {
      container.style.backgroundImage = `url(${this.bgUrl})`;
      container.style.backgroundSize = "cover";
      container.style.backgroundPosition = "center";
      container.style.backgroundAttachment = "fixed";
    }
  }
  // ========================
  // RENDER
  // ========================
  render() {
    const container = this.containerEl.children[1];
    container.empty();
    this.applyBg(container);
    const topBar = container.createEl("div", { cls: "fox-top-bar" });
    const logo = topBar.createEl("div", { cls: "fox-logo-group" });
    logo.createEl("span", { cls: "fox-logo", text: "\u72D0\u306E\u5E74\u8F6E" });
    const nav = topBar.createEl("div", { cls: "fox-review-nav" });
    const prevBtn = nav.createEl("button", { cls: "fox-review-nav-btn", text: "\u2039" });
    nav.createEl("span", { cls: "fox-review-nav-label", text: `${this.year}-${String(this.month).padStart(2, "0")}` });
    const nextBtn = nav.createEl("button", { cls: "fox-review-nav-btn", text: "\u203A" });
    prevBtn.onclick = () => {
      this.month--;
      if (this.month < 1) {
        this.month = 12;
        this.year--;
      }
      this.refresh();
    };
    nextBtn.onclick = () => {
      this.month++;
      if (this.month > 12) {
        this.month = 1;
        this.year++;
      }
      this.refresh();
    };
    const levelPill = topBar.createEl("span", { cls: "fox-level-pill", text: this.getLevelText() });
    const starBtn = topBar.createEl("span", { cls: "fox-star-btn", text: "\u2605" });
    starBtn.onclick = () => {
      container.classList.toggle("fox-amounts-hidden");
      starBtn.classList.toggle("fox-star-active");
    };
    const income = this.txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = this.txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const net = income - expense;
    const summary = container.createEl("div", { cls: "fox-review-summary" });
    summary.createSpan({ cls: "fox-review-summary-income", text: `\u{1F4C8} \u6536\u5165  \xA5${income.toFixed(2)}` });
    summary.createSpan({ cls: "fox-review-summary-expense", text: `\u{1F4C9} \u652F\u51FA  \xA5${expense.toFixed(2)}` });
    summary.createSpan({ cls: `fox-review-summary-net ${net >= 0 ? "positive" : "negative"}`, text: `\u{1F4CA} \u7ED3\u4F59  \xA5${net.toFixed(2)}` });
    if (income > 0) {
      const rate = net / income * 100;
      summary.createSpan({ cls: `fox-review-summary-rate ${rate >= 30 ? "positive" : rate < 0 ? "negative" : ""}`, text: `\u7ED3\u4F59\u7387 ${rate.toFixed(1)}%` });
    }
    const chartRow = container.createEl("div", { cls: "fox-review-chart-row" });
    const pieBox = chartRow.createEl("div", { cls: "fox-review-chart-box" });
    pieBox.createEl("div", { cls: "fox-review-chart-title", text: "\u652F\u51FA\u7ED3\u6784" });
    const pieCanvas = pieBox.createEl("canvas", { cls: "fox-pie-canvas" });
    const barBox = chartRow.createEl("div", { cls: "fox-review-chart-box" });
    barBox.createEl("div", { cls: "fox-review-chart-title", text: "\u6BCF\u65E5\u652F\u51FA\u8D8B\u52BF" });
    const barCanvas = barBox.createEl("canvas", { cls: "fox-bar-canvas" });
    const budgetSection = container.createEl("div", { cls: "fox-review-section" });
    budgetSection.createEl("div", { cls: "fox-review-section-title", text: "\u{1F4CB} \u9884\u7B97\u8FFD\u8E2A" });
    const budgets = this.plugin.settings?.budgets ?? [];
    if (budgets.length === 0) {
      budgetSection.createEl("div", { cls: "fox-review-empty", text: "\u5C1A\u672A\u8BBE\u7F6E\u9884\u7B97\uFF0C\u524D\u5F80\u8BBE\u7F6E\u9875\u6DFB\u52A0" });
    } else {
      const monthly = budgets.filter((b) => b.period === "monthly");
      const yearly = budgets.filter((b) => b.period === "yearly");
      if (monthly.length > 0) {
        if (yearly.length > 0)
          budgetSection.createEl("div", { cls: "fox-review-budget-group-label", text: "\u6708\u5EA6" });
        for (const b of monthly) {
          this.renderBudgetRow(budgetSection, b, this.txs);
        }
      }
      if (yearly.length > 0) {
        budgetSection.createEl("div", { cls: "fox-review-budget-group-label", text: "\u5E74\u5EA6" });
        for (const b of yearly) {
          this.renderBudgetRow(budgetSection, b, this._yearlyTxs || this.txs);
        }
      }
    }
    const acctSection = container.createEl("div", { cls: "fox-review-section" });
    acctSection.createEl("div", { cls: "fox-review-section-title", text: "\u{1F3E6} \u8D26\u6237\u72B6\u6001" });
    const accounts = this.plugin.settings?.accounts ?? [];
    if (accounts.length === 0) {
      acctSection.createEl("div", { cls: "fox-review-empty", text: "\u5C1A\u672A\u8BBE\u7F6E\u8D26\u6237\uFF0C\u524D\u5F80\u8BBE\u7F6E\u9875\u6DFB\u52A0" });
    } else {
      const headRow = acctSection.createEl("div", { cls: "fox-review-acct-row fox-review-acct-header" });
      headRow.createSpan({ cls: "fox-review-acct-name", text: "\u8D26\u6237" });
      headRow.createSpan({ cls: "fox-review-acct-bal", text: "\u4F59\u989D" });
      headRow.createSpan({ cls: "fox-review-acct-income", text: "\u6D41\u5165" });
      headRow.createSpan({ cls: "fox-review-acct-expense", text: "\u6D41\u51FA" });
      headRow.createSpan({ cls: "fox-review-acct-change", text: "\u51C0\u53D8\u52A8" });
      for (const acc of accounts) {
        const bal = this.balances[acc.name] ?? 0;
        let inflow = 0, outflow = 0;
        for (const tx of this.txs) {
          if (tx.type === "balance_adjust")
            continue;
          if (tx.account === acc.name && (tx.type === "income" || tx.type === "refund"))
            inflow += tx.amount;
          if (tx.toAccount === acc.name && (tx.type === "transfer" || tx.type === "investment_return"))
            inflow += tx.amount;
          if (tx.account === acc.name && (tx.type === "expense" || tx.type === "transfer" || tx.type === "investment_in"))
            outflow += tx.amount;
        }
        const netChange = inflow - outflow;
        const row = acctSection.createEl("div", { cls: "fox-review-acct-row" });
        row.createEl("span", { cls: "fox-review-acct-name", text: acc.name });
        row.createEl("span", { cls: "fox-review-acct-bal", text: `\xA5${bal.toFixed(2)}` });
        row.createEl("span", { cls: "fox-review-acct-income", text: `\u6D41\u5165 \xA5${inflow.toFixed(2)}` });
        row.createEl("span", { cls: "fox-review-acct-expense", text: `\u6D41\u51FA \xA5${outflow.toFixed(2)}` });
        const changeCls = netChange > 0 ? "positive" : netChange < 0 ? "negative" : "";
        row.createEl("span", { cls: `fox-review-acct-change${changeCls ? " " + changeCls : ""}`, text: `\u51C0\u53D8\u52A8 ${netChange >= 0 ? "+" : ""}${netChange.toFixed(2)}` });
      }
    }
    const insightSection = container.createEl("div", { cls: "fox-review-section" });
    insightSection.createEl("div", { cls: "fox-review-section-title", text: "\u{1F4DD} \u6708\u5EA6\u70B9\u8BC4" });
    const points = this.generateReviewPoints(income, expense, budgets);
    if (points.length === 0) {
      insightSection.createEl("div", { cls: "fox-review-empty", text: "\u672C\u6708\u6682\u65E0\u6570\u636E" });
    } else {
      for (const p of points) {
        insightSection.createEl("div", { cls: "fox-review-point", text: p });
      }
    }
    const actionRow = container.createEl("div", { cls: "fox-review-action-row" });
    const genBtn = actionRow.createEl("button", { cls: "fox-review-gen-btn", text: "\u{1F4C4} \u751F\u6210\u5E74\u8F6E\u7B14\u8BB0 \u2192 Finance/\u5E74\u8F6E/" });
    genBtn.onclick = () => this.generateNote(income, expense, net);
    const footer = container.createEl("div", { cls: "fox-footer-bar" });
    const tabs = ["\u8D22\u5BCC\u89C2\u6D4B\u53F0", "\u6D41\u6C34\u660E\u7EC6", "\u8D26\u6237\u7BA1\u7406", "\u5E74\u8F6E", "\u68EE\u6797\xB7\u7814\u7A76\u5BA4"];
    tabs.forEach((t, i) => {
      const el = footer.createEl("span", {
        cls: i === 3 ? "fox-footer-tab fox-footer-tab-active" : "fox-footer-tab",
        text: t
      });
      if (i === 0)
        el.onclick = () => this.plugin.activateView();
      if (i === 1)
        el.onclick = () => new FoxFinanceTxModal(this.app, this.plugin).open();
      if (i === 2)
        el.onclick = () => this.app.workspace.trigger("fox-finance:open-settings");
    });
    requestAnimationFrame(() => {
      this.drawPieChart(pieCanvas);
      this.drawBarChart(barCanvas);
    });
  }
  // ========================
  // CANVAS CHARTS
  // ========================
  getCategoryData() {
    const map = /* @__PURE__ */ new Map();
    this.txs.filter((t) => t.type === "expense").forEach((t) => {
      map.set(t.category, (map.get(t.category) || 0) + t.amount);
    });
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.map(([label, value], i) => ({ label, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
  }
  getDailyData() {
    const days = new Date(this.year, this.month, 0).getDate();
    const daily = new Array(days).fill(0);
    this.txs.filter((t) => t.type === "expense").forEach((t) => {
      const day = parseInt(t.date.split("-")[2]);
      if (day >= 1 && day <= days)
        daily[day - 1] += t.amount;
    });
    return daily.map((amount, i) => ({ day: i + 1, amount }));
  }
  drawPieChart(canvas) {
    const data = this.getCategoryData();
    const total = data.reduce((s, d) => s + d.value, 0);
    const ctx = canvas.getContext("2d");
    if (!ctx || total === 0)
      return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const cx = rect.width * 0.38;
    const cy = rect.height / 2;
    const radius = Math.min(cx, cy, 68);
    const innerR = radius * 0.55;
    let start = -Math.PI / 2;
    for (const d of data) {
      const angle = d.value / total * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.arc(cx, cy, innerR, start + angle, start, true);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      start += angle;
    }
    let ly = 8;
    for (const d of data) {
      const pct = Math.round(d.value / total * 100);
      ctx.fillStyle = d.color;
      ctx.fillRect(rect.width * 0.68, ly, 8, 8);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "10px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(`${d.label} ${pct}%`, rect.width * 0.68 + 12, ly + 4);
      ly += 18;
    }
  }
  drawBarChart(canvas) {
    const data = this.getDailyData();
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const pad = { t: 6, r: 4, b: 16, l: 32 };
    const w = rect.width - pad.l - pad.r;
    const h = rect.height - pad.t - pad.b;
    const maxVal = Math.max(...data.map((d) => d.amount), 1);
    const barW = w / data.length;
    for (const d of data) {
      const barH = d.amount / maxVal * h;
      const x = pad.l + (d.day - 1) * barW + 1;
      const y = pad.t + h - barH;
      ctx.fillStyle = d.amount > 0 ? "rgba(167,139,250,0.7)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(x, y, Math.max(barW - 2, 1), barH);
    }
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "9px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("0", 2, pad.t + h - 8);
    ctx.fillText(maxVal.toFixed(0), 2, pad.t + 2);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.textAlign = "center";
    for (let i = 1; i <= data.length; i += 5) {
      ctx.fillText(String(i), pad.l + (i - 1) * barW + barW / 2, pad.t + h + 2);
    }
    const oldTooltip = canvas.parentElement?.querySelector(".fox-bar-tooltip");
    if (oldTooltip)
      oldTooltip.remove();
    const tooltip = canvas.parentElement.createDiv({ cls: "fox-bar-tooltip" });
    tooltip.style.display = "none";
    canvas.onmousemove = (e) => {
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left - pad.l;
      if (mx < 0 || mx > w) {
        tooltip.style.display = "none";
        return;
      }
      const idx = Math.floor(mx / barW);
      if (idx < 0 || idx >= data.length) {
        tooltip.style.display = "none";
        return;
      }
      const d = data[idx];
      if (d.amount <= 0) {
        tooltip.style.display = "none";
        return;
      }
      const barX = pad.l + idx * barW + barW / 2;
      const barTop = pad.t + h - d.amount / maxVal * h;
      tooltip.textContent = `\xA5${d.amount.toFixed(2)}`;
      tooltip.style.display = "block";
      tooltip.style.left = `${barX}px`;
      tooltip.style.top = `${barTop - 8}px`;
      tooltip.style.transform = "translate(-50%, -100%)";
    };
    canvas.onmouseleave = () => {
      tooltip.style.display = "none";
    };
  }
  // ========================
  // REVIEW POINTS
  // ========================
  generateReviewPoints(income, expense, budgets) {
    const points = [];
    if (income > 0) {
      const rate = (income - expense) / income * 100;
      if (rate > 40)
        points.push(`\u672C\u6708\u7ED3\u4F59\u7387 ${rate.toFixed(1)}%\uFF0C\u50A8\u84C4\u4E60\u60EF\u5065\u5EB7 \u{1F44D}`);
      else if (rate > 20)
        points.push(`\u672C\u6708\u7ED3\u4F59\u7387 ${rate.toFixed(1)}%\uFF0C\u6536\u652F\u5E73\u8861\u8FD8\u4E0D\u9519`);
      else if (rate >= 0)
        points.push(`\u672C\u6708\u7ED3\u4F59\u7387 ${rate.toFixed(1)}%\uFF0C\u7565\u6709\u76C8\u4F59\uFF0C\u53EF\u5173\u6CE8\u975E\u5FC5\u8981\u652F\u51FA`);
      else
        points.push(`\u672C\u6708\u652F\u51FA\u8D85\u8FC7\u6536\u5165\uFF0C\u5EFA\u8BAE\u5BA1\u89C6\u5F00\u9500\u7ED3\u6784`);
    } else if (expense > 0) {
      points.push("\u672C\u6708\u6CA1\u6709\u6536\u5165\u8BB0\u5F55\uFF0C\u652F\u51FA\u5168\u9760\u5B58\u91CF");
    }
    const monthlyBudgets = budgets.filter((b) => b.period === "monthly");
    const yearlyBudgets = budgets.filter((b) => b.period === "yearly");
    for (const b of monthlyBudgets) {
      if (b.amount <= 0)
        continue;
      const spent = this.txs.filter((t) => t.type === "expense" && t.category === b.category).reduce((s, t) => s + t.amount, 0);
      if (spent > b.amount) {
        const over = Math.round((spent - b.amount) / b.amount * 100);
        points.push(`\u300C${b.category}\u300D\u8D85\u9884\u7B97 ${over}%\uFF0C\u5B9E\u9645 \xA5${spent.toFixed(0)} / \u9884\u7B97 \xA5${b.amount}`);
      } else if (spent <= b.amount * 0.8) {
        points.push(`\u300C${b.category}\u300D\u63A7\u5236\u5728\u9884\u7B97\u7684 ${Math.round(spent / b.amount * 100)}%\uFF0C\u8868\u73B0\u4E0D\u9519 \u2705`);
      }
    }
    for (const b of yearlyBudgets) {
      if (b.amount <= 0)
        continue;
      const spent = (this._yearlyTxs || this.txs).filter((t) => t.type === "expense" && t.category === b.category).reduce((s, t) => s + t.amount, 0);
      if (spent > b.amount) {
        const over = Math.round((spent - b.amount) / b.amount * 100);
        points.push(`\u300C${b.category}\u300D\u5E74\u5EA6\u8D85\u9884\u7B97 ${over}%\uFF0C\u5B9E\u9645 \xA5${spent.toFixed(0)} / \u9884\u7B97 \xA5${b.amount}`);
      } else if (spent <= b.amount * 0.8) {
        points.push(`\u300C${b.category}\u300D\u5E74\u5EA6\u63A7\u5236\u5728\u9884\u7B97\u7684 ${Math.round(spent / b.amount * 100)}%\uFF0C\u8868\u73B0\u4E0D\u9519 \u2705`);
      }
    }
    const catMap = /* @__PURE__ */ new Map();
    this.txs.filter((t) => t.type === "expense").forEach((t) => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
    });
    const totalExp = [...catMap.values()].reduce((s, v) => s + v, 0);
    if (totalExp > 0) {
      const sorted = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      const topPct = Math.round(top[1] / totalExp * 100);
      points.push(`\u6700\u5927\u652F\u51FA\u7C7B\u522B\uFF1A\u300C${top[0]}\u300D\u5360 ${topPct}%\uFF08\xA5${top[1].toFixed(0)}\uFF09`);
    }
    if (this.txs.some((t) => t.type === "investment_in" || t.type === "investment_return")) {
      points.push("\u672C\u6708\u6709\u6295\u8D44\u64CD\u4F5C\uFF0C\u6301\u7EED\u79EF\u7D2F\u751F\u606F\u8D44\u4EA7 \u{1F331}");
    }
    const learn = this.txs.filter((t) => t.category === "\u5B66\u4E60").reduce((s, t) => s + t.amount, 0);
    if (learn > 0)
      points.push(`\u5B66\u4E60\u6295\u5165 \xA5${learn.toFixed(0)}\uFF0C\u6295\u8D44\u81EA\u5DF1\u662F\u56DE\u62A5\u7387\u6700\u9AD8\u7684\u6295\u8D44 \u{1F4DA}`);
    const days = new Date(this.year, this.month, 0).getDate();
    if (this.txs.length > 0) {
      points.push(`\u672C\u6708\u5171 ${this.txs.length} \u7B14\u4EA4\u6613\uFF0C\u65E5\u5747 ${(this.txs.length / days).toFixed(1)} \u7B14`);
    }
    return points;
  }
  // ========================
  // GENERATE NOTE
  // ========================
  async generateNote(income, expense, net) {
    const dir = "Finance/\u5E74\u8F6E";
    const ym = `${this.year}-${String(this.month).padStart(2, "0")}`;
    const path = `${dir}/${ym}.md`;
    if (!await this.app.vault.adapter.exists(dir)) {
      await this.app.vault.adapter.mkdir(dir);
    }
    const catMap = /* @__PURE__ */ new Map();
    this.txs.filter((t) => t.type === "expense").forEach((t) => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
    });
    const totalExp = [...catMap.values()].reduce((s, v) => s + v, 0);
    const catRows = [...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `| ${cat} | \xA5${amt.toFixed(2)} | ${totalExp > 0 ? (amt / totalExp * 100).toFixed(1) + "%" : "-"} |`).join("\n");
    const budgets = this.plugin.settings?.budgets ?? [];
    const monthlyBudgets = budgets.filter((b) => b.period === "monthly");
    const yearlyBudgets = budgets.filter((b) => b.period === "yearly");
    const budgetRows = [];
    if (monthlyBudgets.length > 0) {
      budgetRows.push("### \u6708\u5EA6\u9884\u7B97");
      monthlyBudgets.filter((b) => b.amount > 0).forEach((b) => {
        const spent = this.txs.filter((t) => t.type === "expense" && t.category === b.category).reduce((s, t) => s + t.amount, 0);
        const pct = Math.round(spent / b.amount * 100);
        budgetRows.push(`| \u6708\u5EA6 | ${b.category} | \xA5${b.amount.toFixed(0)} | \xA5${spent.toFixed(0)} | ${pct}%${pct > 100 ? " \u26A0\uFE0F" : ""} |`);
      });
    }
    if (yearlyBudgets.length > 0) {
      budgetRows.push("### \u5E74\u5EA6\u9884\u7B97");
      const yearlyTxs = this._yearlyTxs || this.txs;
      yearlyBudgets.filter((b) => b.amount > 0).forEach((b) => {
        const spent = yearlyTxs.filter((t) => t.type === "expense" && t.category === b.category).reduce((s, t) => s + t.amount, 0);
        const pct = Math.round(spent / b.amount * 100);
        budgetRows.push(`| \u5E74\u5EA6 | ${b.category} | \xA5${b.amount.toFixed(0)} | \xA5${spent.toFixed(0)} | ${pct}%${pct > 100 ? " \u26A0\uFE0F" : ""} |`);
      });
    }
    const points = this.generateReviewPoints(income, expense, budgets);
    const pointsText = points.map((p) => `- ${p}`).join("\n");
    const rate = income > 0 ? ` | \u7ED3\u4F59\u7387 | ${(net / income * 100).toFixed(1)}% |` : "";
    const content = `---
month: ${ym}
income: ${income.toFixed(2)}
expense: ${expense.toFixed(2)}
net: ${net.toFixed(2)}
count: ${this.txs.length}
created: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}
---

# ${ym} \xB7 \u5E74\u8F6E

## \u6708\u5EA6\u6982\u89C8

| \u9879\u76EE | \u91D1\u989D |
|------|------|
| \u6536\u5165 | \xA5${income.toFixed(2)} |
| \u652F\u51FA | \xA5${expense.toFixed(2)} |
| \u7ED3\u4F59 | \xA5${net.toFixed(2)}${rate}

## \u652F\u51FA\u5206\u7C7B

| \u5206\u7C7B | \u91D1\u989D | \u5360\u6BD4 |
|------|------|------|
${catRows}

${budgetRows.length > 0 ? `## \u9884\u7B97\u8FFD\u8E2A

| \u5468\u671F | \u5206\u7C7B | \u9884\u7B97 | \u5B9E\u9645 | \u6267\u884C\u7387 |
|------|------|------|------|--------|
${budgetRows.join("\n")}
` : ""}## \u70B9\u8BC4

${pointsText}
`;
    await this.app.vault.adapter.write(path, content);
    new import_obsidian7.Notice(`\u2705 \u5E74\u8F6E\u7B14\u8BB0\u5DF2\u4FDD\u5B58\uFF1A${path}`);
  }
  // ========================
  // HELPERS
  // ========================
  renderBudgetRow(parent, b, txs) {
    const spent = txs.filter((t) => t.type === "expense" && t.category === b.category).reduce((s, t) => s + t.amount, 0);
    const pct = b.amount > 0 ? Math.round(spent / b.amount * 100) : 0;
    const over = pct > 100;
    const row = parent.createEl("div", { cls: "fox-review-budget-row" });
    row.createEl("span", { cls: "fox-review-budget-label", text: b.category });
    const bar = row.createEl("div", { cls: "fox-review-budget-bar" });
    bar.createEl("div", {
      cls: `fox-review-budget-fill${over ? " over" : ""}`,
      attr: { style: `width: ${Math.min(pct, 100)}%` }
    });
    row.createEl("span", {
      cls: `fox-review-budget-text${over ? " over" : ""}`,
      text: `\xA5${spent.toFixed(0)} / \xA5${b.amount}${over ? " \u26A0\uFE0F" : ""}`
    });
  }
  getLevelText() {
    const net = Object.values(this.balances).reduce((s, v) => s + v, 0);
    return net > 5e4 ? "\u{1F333} Lv.3" : net > 1e4 ? "\u{1F331} Lv.2" : "\u{1F330} Lv.1";
  }
};

// main.ts
var DEFAULT_SETTINGS = {
  accounts: [
    { name: "\u5FAE\u4FE1", type: "cash" },
    { name: "\u652F\u4ED8\u5B9D", type: "cash" },
    { name: "\u94F6\u884C\u5361", type: "cash" },
    { name: "\u6708\u6708\u5B9D", type: "investment" },
    { name: "\u5B63\u5B63\u5B9D", type: "investment" }
  ],
  categories: [
    { name: "\u9910\u996E", type: "expense", subcategories: ["\u4E09\u9910", "\u5916\u5356", "\u996E\u54C1", "\u96F6\u98DF"] },
    { name: "\u4EA4\u901A", type: "expense", subcategories: ["\u5730\u94C1", "\u6253\u8F66", "\u52A0\u6CB9", "\u5171\u4EAB\u5355\u8F66"] },
    { name: "\u8D2D\u7269", type: "expense", subcategories: ["\u65E5\u7528", "\u8863\u7269", "\u6570\u7801", "\u5BB6\u5C45"] },
    { name: "\u5B66\u4E60", type: "expense", subcategories: ["\u8BFE\u7A0B", "\u4E66\u7C4D", "\u6587\u5177"] },
    { name: "\u5A31\u4E50", type: "expense", subcategories: ["\u7535\u5F71", "\u6E38\u620F", "\u65C5\u884C", "\u793E\u4EA4"] },
    { name: "\u5C45\u4F4F", type: "expense", subcategories: ["\u623F\u79DF", "\u6C34\u7535", "\u7F51\u7EDC", "\u7269\u4E1A"] },
    { name: "\u533B\u7597", type: "expense", subcategories: ["\u95E8\u8BCA", "\u836F\u54C1", "\u4F53\u68C0"] },
    { name: "\u5176\u4ED6", type: "expense", subcategories: ["\u5176\u4ED6"] },
    { name: "\u5DE5\u8D44", type: "income", subcategories: ["\u5B9E\u4E60", "\u517C\u804C", "\u5956\u91D1"] },
    { name: "\u5176\u4ED6\u6536\u5165", type: "income", subcategories: ["\u7EA2\u5305", "\u9000\u6B3E", "\u5176\u4ED6"] }
  ],
  budgets: [
    { category: "\u9910\u996E", amount: 1500, period: "monthly" },
    { category: "\u4EA4\u901A", amount: 300, period: "monthly" },
    { category: "\u5B66\u4E60", amount: 500, period: "monthly" }
  ],
  bgTheme: "galaxy",
  customBgPaths: [],
  tags: ["\u5DE5\u4F5C", "\u5DEE\u65C5", "\u4E2A\u4EBA"]
};
var BG_POOLS = {
  galaxy: ["\u94F6\u6CB3\u68EE\u6797.png", "\u94F6\u6CB3\u68EE\u67972.png"],
  glasshouse: ["\u68EE\u6797\u73BB\u7483\u5C4B.png", "\u68EE\u6797\u73BB\u7483\u5C4B2.png"]
};
var ASSET_ROOT = ".obsidian/plugins/fox-finance/Asset/";
var FoxFinancePlugin = class extends import_obsidian8.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.blobCache = /* @__PURE__ */ new Map();
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.dataLayer = new FinanceDataLayer(this.app);
    await this.dataLayer.ensureDirectories();
    this.registerView(
      VIEW_TYPE_FOX_FINANCE,
      (leaf) => new FoxFinanceView(leaf, this)
    );
    this.registerView(
      VIEW_TYPE_FOX_REVIEW,
      (leaf) => new FoxFinanceReviewView(leaf, this)
    );
    this.addCommand({
      id: "fox-finance:open-dashboard",
      name: "\u6253\u5F00\u8D22\u5BCC\u68EE\u6797\u770B\u677F",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "fox-finance:quick-add",
      name: "\u8BB0\u4E00\u7B14\uFF08\u5FEB\u901F\u8BB0\u8D26\uFF09",
      callback: () => this.openQuickAddModal()
    });
    this.registerEvent(
      this.app.workspace.on("fox-finance:quick-add", () => this.openQuickAddModal())
    );
    this.registerEvent(
      this.app.workspace.on("fox-finance:open-settings", () => {
        this.app.setting.open();
        this.app.setting.openTabById("fox-finance");
      })
    );
    this.registerEvent(
      this.app.workspace.on("fox-finance:open-review", () => this.activateReviewView())
    );
    this.addRibbonIcon("wallet", "Fox Finance", () => this.activateView());
    this.addSettingTab(new FoxFinanceSettingTab(this.app, this));
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_FOX_FINANCE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_FOX_REVIEW);
    for (const url of this.blobCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobCache.clear();
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_FOX_FINANCE).first();
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      if (!leaf)
        return;
      await leaf.setViewState({ type: VIEW_TYPE_FOX_FINANCE, active: true });
    }
    workspace.revealLeaf(leaf);
    if (leaf.view instanceof FoxFinanceView) {
      leaf.view.refresh();
    }
  }
  async activateReviewView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_FOX_REVIEW).first();
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      if (!leaf)
        return;
      await leaf.setViewState({ type: VIEW_TYPE_FOX_REVIEW, active: true });
    }
    workspace.revealLeaf(leaf);
    if (leaf.view instanceof FoxFinanceReviewView) {
      leaf.view.refresh();
    }
  }
  openQuickAddModal() {
    new FoxFinanceModal(this.app, this, () => {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOX_FINANCE).first();
      if (leaf?.view instanceof FoxFinanceView)
        leaf.view.refresh();
    }).open();
  }
  // ─── Assets ─────────────────────────────────────
  /** 读取 Asset 目录下文件，返回 blob:// URL */
  async readAsset(subpath) {
    const cached = this.blobCache.get(subpath);
    if (cached)
      return cached;
    const fullPath = ASSET_ROOT + subpath;
    try {
      const data = await this.app.vault.adapter.readBinary(fullPath);
      const blob = new Blob([data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      this.blobCache.set(subpath, url);
      return url;
    } catch {
      return "";
    }
  }
  /** 读取 vault 中任意路径的图片，返回 blob:// URL */
  async readVaultFile(path) {
    const key = `vault:${path}`;
    const cached = this.blobCache.get(key);
    if (cached)
      return cached;
    try {
      const data = await this.app.vault.adapter.readBinary(path);
      const ext = path.split(".").pop()?.toLowerCase() || "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      const blob = new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      this.blobCache.set(key, url);
      return url;
    } catch {
      return "";
    }
  }
  /** 获取背景图 URL（内置图片 + 自定义图片随机轮换） */
  async getRandomBgUrl() {
    const pool = [];
    if (this.settings.bgTheme === "custom") {
      for (const p of this.settings.customBgPaths) {
        const url = await this.readVaultFile(p);
        if (url)
          pool.push(url);
      }
      if (pool.length === 0) {
        new import_obsidian8.Notice("\u672A\u8BBE\u7F6E\u81EA\u5B9A\u4E49\u80CC\u666F\u56FE\uFF0C\u8BF7\u5728\u4E3B\u9898\u8BBE\u7F6E\u4E2D\u9009\u62E9\u5185\u7F6E\u4E3B\u9898\u6216\u6DFB\u52A0\u56FE\u7247\u8DEF\u5F84");
        return "";
      }
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const themePool = BG_POOLS[this.settings.bgTheme];
    if (themePool) {
      for (const f of themePool) {
        const url = await this.readAsset(`background/${f}`);
        if (url)
          pool.push(url);
      }
    }
    if (this.settings.bgTheme !== "custom") {
      for (const p of this.settings.customBgPaths) {
        const url = await this.readVaultFile(p);
        if (url)
          pool.push(url);
      }
    }
    if (pool.length === 0)
      return "";
    return pool[Math.floor(Math.random() * pool.length)];
  }
  /** 获取图标 URL */
  async getIconUrl(name) {
    return this.readAsset(`icons/${name}`);
  }
};
var FoxFinanceSettingTab = class extends import_obsidian8.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  get p() {
    return this.plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u2726 Fox Finance \u8BBE\u7F6E" });
    containerEl.createEl("h3", { text: "\u80CC\u666F\u4E3B\u9898" });
    new import_obsidian8.Setting(containerEl).setName("\u80CC\u666F\u4E3B\u9898").setDesc('\u9009\u62E9\u5185\u7F6E\u4E3B\u9898\uFF0C\u6216\u9009"\u81EA\u5B9A\u4E49"\u4F7F\u7528\u4E0B\u65B9\u6DFB\u52A0\u7684\u56FE\u7247').addDropdown((d) => {
      d.addOption("galaxy", "\u{1F30C} \u94F6\u6CB3\u68EE\u6797");
      d.addOption("glasshouse", "\u{1F3E1} \u68EE\u6797\u73BB\u7483\u5C4B");
      d.addOption("custom", "\u{1F5BC}\uFE0F \u81EA\u5B9A\u4E49");
      d.setValue(this.p.settings.bgTheme);
      d.onChange(async (v) => {
        this.p.settings.bgTheme = v;
        await this.p.saveData(this.p.settings);
        this.display();
        this.p.activateView();
      });
    });
    containerEl.createEl("h4", { text: "\u81EA\u5B9A\u4E49\u80CC\u666F\u56FE\u7247" });
    const bgDesc = containerEl.createEl("p", {
      cls: "setting-item-description",
      text: '\u6DFB\u52A0 vault \u5185\u7684\u56FE\u7247\u8DEF\u5F84\uFF08\u5982 "\u9644\u4EF6\u7684\u56FE\u7247/\u68EE\u6797.png"\uFF09\uFF0C\u8BBE\u7F6E\u9875\u548C\u770B\u677F\u90FD\u4F1A\u968F\u673A\u8F6E\u6362'
    });
    bgDesc.style.margin = "0 0 12px";
    const bgList = containerEl.createDiv();
    this.renderBgPathList(bgList);
    new import_obsidian8.Setting(containerEl).addButton((b) => b.setButtonText("\uFF0B \u6DFB\u52A0\u56FE\u7247\u8DEF\u5F84").setCta().onClick(async () => {
      this.p.settings.customBgPaths.push("");
      await this.p.saveData(this.p.settings);
      this.display();
    }));
    containerEl.createEl("h3", { text: "\u8D26\u6237\u7BA1\u7406" });
    const accountList = containerEl.createDiv();
    this.renderAccountList(accountList);
    new import_obsidian8.Setting(containerEl).addButton((b) => b.setButtonText("\uFF0B \u6DFB\u52A0\u8D26\u6237").setCta().onClick(async () => {
      this.p.settings.accounts.push({ name: "", type: "cash" });
      await this.p.saveData(this.p.settings);
      this.display();
    }));
    containerEl.createEl("h3", { text: "\u5206\u7C7B\u7BA1\u7406" });
    const catList = containerEl.createDiv();
    this.renderCategoryList(catList);
    new import_obsidian8.Setting(containerEl).addButton((b) => b.setButtonText("\uFF0B \u6DFB\u52A0\u5206\u7C7B").setCta().onClick(async () => {
      this.p.settings.categories.push({ name: "", type: "expense", subcategories: ["\u5176\u4ED6"] });
      await this.p.saveData(this.p.settings);
      this.display();
    }));
    containerEl.createEl("h3", { text: "\u9884\u7B97" });
    const budgetList = containerEl.createDiv();
    this.renderBudgetList(budgetList);
    new import_obsidian8.Setting(containerEl).addButton((b) => b.setButtonText("\uFF0B \u6DFB\u52A0\u9884\u7B97").setCta().onClick(async () => {
      const firstCat = this.p.settings.categories.find((c) => c.type === "expense");
      this.p.settings.budgets.push({ category: firstCat?.name || "", amount: 0, period: "monthly" });
      await this.p.saveData(this.p.settings);
      this.display();
    }));
    containerEl.createEl("h3", { text: "\u6807\u7B7E\u7BA1\u7406" });
    containerEl.createEl("p", { cls: "setting-item-description", text: '\u7ED9\u4EA4\u6613\u6253\u6807\u7B7E\uFF0C\u65B9\u4FBF\u6309\u573A\u666F\u7B5B\u9009\uFF08\u5982"\u5DE5\u4F5C"\u76F8\u5173\u7684\u6253\u8F66\u8D39\uFF09' });
    const tagList = containerEl.createDiv();
    this.renderTagList(tagList);
    new import_obsidian8.Setting(containerEl).addButton((b) => b.setButtonText("\uFF0B \u6DFB\u52A0\u6807\u7B7E").setCta().onClick(async () => {
      this.p.settings.tags.push("");
      await this.p.saveData(this.p.settings);
      this.display();
    }));
    containerEl.createEl("hr");
    new import_obsidian8.Setting(containerEl).addButton((b) => b.setButtonText("\u{1F4BE} \u4FDD\u5B58\u8BBE\u7F6E").setCta().onClick(async () => {
      await this.p.saveData(this.p.settings);
      new import_obsidian8.Notice("\u2705 \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    }));
  }
  // ─── Background Path List ──────────────────────────
  renderBgPathList(el) {
    const paths = this.p.settings.customBgPaths;
    if (paths.length === 0) {
      el.createEl("p", { cls: "fox-sub-empty", text: "\u5C1A\u672A\u6DFB\u52A0\u81EA\u5B9A\u4E49\u80CC\u666F\u56FE\u7247" });
      return;
    }
    paths.forEach((p, i) => {
      const s = new import_obsidian8.Setting(el).addText((t) => t.setPlaceholder("\u9644\u4EF6\u7684\u56FE\u7247/\u98CE\u666F.png").setValue(p).onChange(async (v) => {
        paths[i] = v;
        await this.p.saveData(this.p.settings);
      })).addButton((b) => b.setIcon("trash").setWarning().onClick(async () => {
        paths.splice(i, 1);
        await this.p.saveData(this.p.settings);
        this.display();
      }));
      s.settingEl.addClass("fox-setting-row");
    });
  }
  // ─── Account List ────────────────────────────────
  renderAccountList(el) {
    this.p.settings.accounts.forEach((acc, i) => {
      const s = new import_obsidian8.Setting(el).addText((t) => t.setPlaceholder("\u8D26\u6237\u540D\u79F0").setValue(acc.name).onChange(async (v) => {
        this.p.settings.accounts[i].name = v;
        await this.p.saveData(this.p.settings);
      })).addDropdown((d) => d.addOption("cash", "\u73B0\u91D1\u8D26\u6237").addOption("investment", "\u6295\u8D44\u8D26\u6237").setValue(acc.type).onChange(async (v) => {
        this.p.settings.accounts[i].type = v;
        await this.p.saveData(this.p.settings);
      })).addButton((b) => b.setIcon("trash").setWarning().onClick(async () => {
        this.p.settings.accounts.splice(i, 1);
        await this.p.saveData(this.p.settings);
        this.display();
      }));
      s.settingEl.addClass("fox-setting-row");
    });
  }
  // ─── Category List ──────────────────────────────
  renderCategoryList(el) {
    this.p.settings.categories.forEach((cat, i) => {
      const s = new import_obsidian8.Setting(el).addText((t) => t.setPlaceholder("\u5206\u7C7B\u540D\u79F0").setValue(cat.name).onChange(async (v) => {
        this.p.settings.categories[i].name = v;
        await this.p.saveData(this.p.settings);
      })).addDropdown((d) => d.addOption("expense", "\u652F\u51FA").addOption("income", "\u6536\u5165").setValue(cat.type).onChange(async (v) => {
        this.p.settings.categories[i].type = v;
        await this.p.saveData(this.p.settings);
      })).addButton((b) => b.setIcon("plus-circle").setTooltip("\u6DFB\u52A0\u5B50\u5206\u7C7B").onClick(() => {
        this.p.settings.categories[i].subcategories.push("");
        this.display();
      })).addButton((b) => b.setIcon("trash").setWarning().onClick(async () => {
        this.p.settings.categories.splice(i, 1);
        await this.p.saveData(this.p.settings);
        this.display();
      }));
      const subEl = el.createDiv({ cls: "fox-setting-subs" });
      cat.subcategories.forEach((sub, j) => {
        const tag = subEl.createSpan({ cls: "fox-sub-tag" });
        const input = tag.createEl("input", { cls: "fox-sub-input", attr: { placeholder: "\u5B50\u5206\u7C7B\u540D\u79F0", value: sub } });
        input.onchange = async () => {
          cat.subcategories[j] = input.value;
          await this.p.saveData(this.p.settings);
        };
        const delBtn = tag.createEl("span", { cls: "fox-sub-del", text: "\u2715" });
        delBtn.onclick = async () => {
          cat.subcategories.splice(j, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        };
      });
      if (cat.subcategories.length === 0) {
        subEl.createSpan({ cls: "fox-sub-empty", text: "\u65E0\u5B50\u5206\u7C7B" });
      }
    });
  }
  // ─── Budget List ────────────────────────────────
  renderBudgetList(el) {
    this.p.settings.budgets.forEach((budget, i) => {
      const s = new import_obsidian8.Setting(el).addDropdown((d) => {
        const expenseCats = this.p.settings.categories.filter((c) => c.type === "expense");
        (expenseCats.length ? expenseCats : [{ name: "\u9910\u996E" }, { name: "\u4EA4\u901A" }]).forEach((c) => d.addOption(c.name, c.name));
        d.setValue(budget.category);
        d.onChange(async (v) => {
          this.p.settings.budgets[i].category = v;
          await this.p.saveData(this.p.settings);
        });
      }).addText((t) => t.setPlaceholder("\u91D1\u989D").setValue(String(budget.amount || "")).onChange(async (v) => {
        this.p.settings.budgets[i].amount = parseFloat(v) || 0;
        await this.p.saveData(this.p.settings);
      })).addDropdown((d) => d.addOption("monthly", "\u6708").addOption("yearly", "\u5E74").setValue(budget.period).onChange(async (v) => {
        this.p.settings.budgets[i].period = v;
        await this.p.saveData(this.p.settings);
      })).addButton((b) => b.setIcon("trash").setWarning().onClick(async () => {
        this.p.settings.budgets.splice(i, 1);
        await this.p.saveData(this.p.settings);
        this.display();
      }));
      s.settingEl.addClass("fox-setting-row");
    });
  }
  // ─── Tag List ─────────────────────────────────────
  renderTagList(el) {
    this.p.settings.tags.forEach((tag, i) => {
      const s = new import_obsidian8.Setting(el).addText((t) => t.setPlaceholder("\u6807\u7B7E\u540D\u79F0").setValue(tag).onChange(async (v) => {
        this.p.settings.tags[i] = v;
        await this.p.saveData(this.p.settings);
      })).addButton((b) => b.setIcon("trash").setWarning().onClick(async () => {
        this.p.settings.tags.splice(i, 1);
        await this.p.saveData(this.p.settings);
        this.display();
      }));
      s.settingEl.addClass("fox-setting-row");
    });
  }
};
