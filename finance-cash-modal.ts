import { App, Modal } from 'obsidian';
import type FoxFinancePlugin from './main';

export class FoxFinanceCashModal extends Modal {
  constructor(
    app: App,
    private plugin: FoxFinancePlugin,
    private balances: Record<string, number>,
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass('fox-finance-modal', 'fox-cash-modal');
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    // ── 标题 ──
    const titleRow = contentEl.createDiv({ cls: 'fox-cash-title-row' });
    titleRow.createEl('span', { cls: 'fox-cash-title-icon', text: '📖' });
    titleRow.createEl('span', { cls: 'fox-cash-title', text: '现金流档案' });
    titleRow.createEl('span', { cls: 'fox-cash-subtitle', text: '所有现金账户一览' });

    // ── 汇总统计 ──
    const accounts = this.plugin.settings?.accounts ?? [];
    const cashAccounts = accounts.filter(a => a.type === 'cash');
    const totalBalance = cashAccounts.reduce((s, a) => s + (this.balances[a.name] ?? 0), 0);
    const positiveAccounts = cashAccounts.filter(a => (this.balances[a.name] ?? 0) > 0).length;

    const statRow = contentEl.createDiv({ cls: 'fox-cash-stat-row' });
    const totalStat = statRow.createDiv({ cls: 'fox-cash-stat' });
    totalStat.createEl('span', { cls: 'fox-cash-stat-label', text: '总余额' });
    totalStat.createEl('span', { cls: 'fox-cash-stat-value', text: `¥${totalBalance.toFixed(2)}` });

    const countStat = statRow.createDiv({ cls: 'fox-cash-stat' });
    countStat.createEl('span', { cls: 'fox-cash-stat-label', text: '账户数' });
    countStat.createEl('span', { cls: 'fox-cash-stat-value fox-cash-stat-count', text: `${cashAccounts.length}` });

    const activeStat = statRow.createDiv({ cls: 'fox-cash-stat' });
    activeStat.createEl('span', { cls: 'fox-cash-stat-label', text: '有余额' });
    activeStat.createEl('span', { cls: 'fox-cash-stat-value fox-cash-stat-active', text: `${positiveAccounts}` });

    // ── 账户列表 ──
    if (cashAccounts.length === 0) {
      const empty = contentEl.createDiv({ cls: 'fox-cash-empty' });
      empty.createEl('span', { cls: 'fox-cash-empty-icon', text: '🌱' });
      empty.createEl('span', { text: '还没有现金账户，先去设置页添加吧' });
    } else {
      const list = contentEl.createDiv({ cls: 'fox-cash-list' });
      for (const acc of cashAccounts) {
        const bal = this.balances[acc.name] ?? 0;
        const row = list.createDiv({ cls: 'fox-cash-item' });
        row.createEl('span', { cls: 'fox-cash-item-dot', text: '●' });
        row.createEl('span', { cls: 'fox-cash-item-name', text: acc.name });
        const amtEl = row.createEl('span', { cls: `fox-cash-item-amt${bal >= 0 ? '' : ' negative'}` });
        amtEl.textContent = `¥${bal.toFixed(2)}`;
      }
    }

    // ── 底部 ──
    const footer = contentEl.createDiv({ cls: 'fox-cash-footer' });
    const closeBtn = footer.createEl('button', { cls: 'fox-cash-close-btn', text: '关闭' });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
