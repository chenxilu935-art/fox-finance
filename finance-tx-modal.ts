import { App, Modal, Notice } from 'obsidian';
import { FinanceDataLayer, Transaction, TransactionType, TRANSACTION_TYPE_LABELS } from './finance';
import { FoxFinanceModal, EditContext } from './finance-modal';
import type FoxFinancePlugin from './main';

interface TxEntry {
  tx: Transaction;
  originalIndex: number;
}

export class FoxFinanceTxModal extends Modal {
  private dl: FinanceDataLayer;
  private year: number;
  private month: number;
  private entries: TxEntry[] = [];
  private filtered: TxEntry[] = [];

  private filterType = 'all';
  private filterAccount = 'all';
  private filterTag = 'all';

  private accounts: string[] = [];
  private typeOptions: { value: string; label: string }[] = [];
  private tagOptions: { value: string; label: string }[] = [];

  constructor(
    app: App,
    private plugin: FoxFinancePlugin,
  ) {
    super(app);
    this.dl = new FinanceDataLayer(app);

    const d = new Date();
    this.year = d.getFullYear();
    this.month = d.getMonth() + 1;

    // 从 settings 加载账户列表
    this.accounts = plugin.settings.accounts?.map(a => a.name) ?? [];

    // 构建类型筛选选项
    this.typeOptions = [
      { value: 'all', label: '全部类型' },
      ...Object.entries(TRANSACTION_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
    ];

    // 构建标签筛选选项
    const tags = plugin.settings.tags ?? [];
    this.tagOptions = [
      { value: 'all', label: '全部标签' },
      ...tags.map(t => ({ value: t, label: t })),
      { value: 'none', label: '无标签' },
    ];
  }

  onOpen() {
    this.modalEl.addClass('fox-finance-modal', 'fox-tx-modal');
    this.loadAndRender();
  }

  private async loadAndRender() {
    const txs = await this.dl.readLedger(this.year, this.month);
    this.entries = txs.map((tx, i) => ({ tx, originalIndex: i }));
    this.applyFilters();
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    // ─── 标题行 + 月份导航 ───
    const header = contentEl.createDiv({ cls: 'fox-tx-header' });
    header.createEl('span', { cls: 'fox-tx-title', text: '✦ 流水明细' });

    const nav = header.createDiv({ cls: 'fox-tx-nav' });
    const prevBtn = nav.createEl('button', { cls: 'fox-tx-nav-btn', text: '‹' });
    nav.createEl('span', { cls: 'fox-tx-nav-month', text: `${this.year}-${String(this.month).padStart(2, '0')}` });
    const nextBtn = nav.createEl('button', { cls: 'fox-tx-nav-btn', text: '›' });

    prevBtn.onclick = () => { this.month--; if (this.month < 1) { this.month = 12; this.year--; } this.loadAndRender(); };
    nextBtn.onclick = () => { this.month++; if (this.month > 12) { this.month = 1; this.year++; } this.loadAndRender(); };

    // ─── 汇总栏 ───
    const income = this.filtered.filter(e => e.tx.type === 'income').reduce((s, e) => s + e.tx.amount, 0);
    const expense = this.filtered.filter(e => e.tx.type === 'expense').reduce((s, e) => s + e.tx.amount, 0);
    const net = income - expense;

    const summary = contentEl.createDiv({ cls: 'fox-tx-summary' });
    summary.createSpan({ cls: 'fox-tx-summary-income', text: `📈 收入  ¥${income.toFixed(2)}` });
    summary.createSpan({ cls: 'fox-tx-summary-expense', text: `📉 支出  ¥${expense.toFixed(2)}` });
    summary.createSpan({ cls: `fox-tx-summary-net ${net >= 0 ? 'positive' : 'negative'}`, text: `📊 结余  ¥${net.toFixed(2)}` });

    // ─── 筛选栏 ───
    const filters = contentEl.createDiv({ cls: 'fox-tx-filters' });
    this.buildDropdown(filters, this.filterType, this.typeOptions, v => { this.filterType = v; this.applyFilters(); this.render(); });
    this.buildDropdown(filters, this.filterAccount,
      [{ value: 'all', label: '全部账户' }, ...this.accounts.map(a => ({ value: a, label: a }))],
      v => { this.filterAccount = v; this.applyFilters(); this.render(); });
    this.buildDropdown(filters, this.filterTag, this.tagOptions, v => { this.filterTag = v; this.applyFilters(); this.render(); });

    // ─── 流水表格（按日期分组） ───
    const table = contentEl.createDiv({ cls: 'fox-tx-table' });

    if (this.filtered.length === 0) {
      table.createDiv({ cls: 'fox-tx-empty', text: '没有匹配的流水记录' });
    } else {
      const groups = this.groupByDate(this.filtered);
      for (const [groupLabel, rows] of groups) {
        table.createDiv({ cls: 'fox-tx-group-header', text: groupLabel });

        for (const entry of rows) {
          const row = table.createDiv({ cls: 'fox-tx-modal-row' });
          const { tx, originalIndex } = entry;
          const isNeg = tx.type === 'expense' || tx.type === 'transfer' || tx.type === 'investment_in';

          row.createSpan({ cls: 'fox-tx-col-date', text: tx.date.slice(5) });
          row.createSpan({ cls: `fox-tx-col-type fox-tx-type-${tx.type}`, text: TRANSACTION_TYPE_LABELS[tx.type] || tx.type });
          row.createSpan({ cls: 'fox-tx-col-cat', text: `${tx.category}${tx.subcategory ? '/' + tx.subcategory : ''}` });
          row.createSpan({ cls: 'fox-tx-col-acct', text: tx.account });
          const amtEl = row.createSpan({ cls: `fox-tx-col-amt ${isNeg ? 'negative' : 'positive'}`, text: `${isNeg ? '-' : '+'}${tx.amount.toFixed(2)}` });
          if (tx.toAccount) amtEl.title = `→ ${tx.toAccount}`;

          const note = tx.note?.trim();
          const hasNote = !!note;
          const tags = tx.tags ? tx.tags.split(',').map(s => s.trim()).filter(Boolean) : [];

          // 备注 + 标签组合列
          const noteCol = row.createSpan({ cls: 'fox-tx-col-note' });
          if (hasNote) {
            const noteText = noteCol.createSpan({ cls: 'fox-tx-note-text', text: note });
          }
          if (tags.length > 0) {
            tags.forEach(t => {
              noteCol.createSpan({ cls: 'fox-tx-tag', text: t });
            });
          }

          // ─── 操作按钮 ───
          const actions = row.createDiv({ cls: 'fox-tx-actions' });

          const editBtn = actions.createEl('button', { cls: 'fox-tx-action-btn fox-tx-action-edit', text: '✎' });
          editBtn.title = '编辑';
          editBtn.onclick = (e) => { e.stopPropagation(); this.editTx(entry); };

          const delBtn = actions.createEl('button', { cls: 'fox-tx-action-btn fox-tx-action-del', text: '✕' });
          delBtn.title = '删除';
          delBtn.onclick = (e) => { e.stopPropagation(); this.deleteTx(entry); };
        }
      }
    }
  }

  // ─── 编辑 ──────────────────────────────────────────────

  private editTx(entry: TxEntry) {
    const editCtx: EditContext = {
      year: String(this.year),
      month: String(this.month).padStart(2, '0'),
      index: entry.originalIndex,
      tx: { ...entry.tx },
    };
    new FoxFinanceModal(this.app, this.plugin, () => this.loadAndRender(), editCtx).open();
  }

  // ─── 删除 ──────────────────────────────────────────────

  private async deleteTx(entry: TxEntry) {
    const confirmed = confirm(`确定要删除这笔交易吗？\n\n${entry.tx.date}  ${TRANSACTION_TYPE_LABELS[entry.tx.type]}  ¥${entry.tx.amount.toFixed(2)}  ${entry.tx.note || ''}`);
    if (!confirmed) return;

    try {
      await this.dl.deleteTx(
        String(this.year),
        String(this.month).padStart(2, '0'),
        entry.originalIndex,
      );
      new Notice('🗑️ 已删除');
      await this.loadAndRender();
    } catch (e) {
      new Notice('❌ 删除失败：' + (e as any).message);
    }
  }

  // ─── Helpers ──────────────────────────────────────────

  private buildDropdown(parent: HTMLElement, _current: string, options: { value: string; label: string }[], onChange: (v: string) => void) {
    const sel = parent.createEl('select', { cls: 'fox-tx-filter-select' });
    options.forEach(o => {
      const opt = sel.createEl('option');
      opt.value = o.value;
      opt.text = o.label;
      if (o.value === _current) opt.selected = true;
    });
    sel.onchange = () => onChange(sel.value);
  }

  private applyFilters() {
    this.filtered = this.entries.filter(e => {
      if (this.filterType !== 'all' && e.tx.type !== this.filterType) return false;
      if (this.filterAccount !== 'all' && e.tx.account !== this.filterAccount) return false;
      if (this.filterTag !== 'all') {
        const txTags = e.tx.tags ? e.tx.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
        if (this.filterTag === 'none') {
          if (txTags.length > 0) return false;
        } else {
          if (!txTags.includes(this.filterTag)) return false;
        }
      }
      return true;
    });
  }

  /** 按日期分组，倒序排列 */
  private groupByDate(txs: TxEntry[]): [string, TxEntry[]][] {
    const map = new Map<string, TxEntry[]>();

    for (const entry of txs) {
      if (!map.has(entry.tx.date)) map.set(entry.tx.date, []);
      map.get(entry.tx.date)!.push(entry);
    }

    const todayStr = this.dateStr(new Date());
    const yesterdayStr = this.dateStr(new Date(Date.now() - 86400000));

    const result: [string, TxEntry[]][] = [];
    const sorted = [...map.keys()].sort().reverse();

    for (const d of sorted) {
      let label: string;
      if (d === todayStr) label = '今 天';
      else if (d === yesterdayStr) label = '昨 天';
      else label = d.slice(5);
      result.push([label, map.get(d)!]);
    }

    return result;
  }

  private dateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  onClose() {
    this.contentEl.empty();
  }
}
