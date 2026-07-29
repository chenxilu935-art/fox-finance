import { ItemView, WorkspaceLeaf } from 'obsidian';
import { FinanceDataLayer, Transaction, TRANSACTION_TYPE_LABELS } from './finance';
import { FoxFinanceTxModal } from './finance-tx-modal';
import { FoxFinanceAdjustModal } from './finance-adjust-modal';
import { FoxFinanceCashModal } from './finance-cash-modal';
import type FoxFinancePlugin from './main';

export const VIEW_TYPE_FOX_FINANCE = 'fox-finance-dashboard';

export class FoxFinanceView extends ItemView {
  private dl: FinanceDataLayer;
  private txs: Transaction[] = [];
  private balances: Record<string, number> = {};
  private yearlySpending: Record<string, number> = {};
  private bgUrl = '';
  private loadedIcons = false;

  // 图标 URL 缓存（从插件异步加载后缓存）
  private iconUrls: Record<string, string> = {};

  constructor(leaf: WorkspaceLeaf, private plugin: FoxFinancePlugin) {
    super(leaf);
    this.dl = new FinanceDataLayer(this.app);
  }

  getViewType(): string { return VIEW_TYPE_FOX_FINANCE; }
  getDisplayText(): string { return '狐の财富森林'; }
  getIcon(): string { return 'wallet'; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('fox-finance-view');

    this.registerEvent(
      this.app.workspace.on('fox-finance:updated', () => this.refresh()),
    );

    await this.refresh();
    this.loadedIcons = true;
  }

  async refresh() {
    const container = this.containerEl.children[1] as HTMLElement;
    if (!container) return;

    // 预加载图标
    const iconNames = [
      '星空之狼.png', '幼苗.png', '财富树.png', '星辰水晶球.png',
      '财富圆盘.png', '银河玻璃瓶.png', '羽毛账本.png', '星河小路.png',
      '发光灯笼.png', '星空日历.png', '狼徽盾牌.png',
    ];
    await Promise.all(iconNames.map(async (name) => {
      if (!this.iconUrls[name]) {
        this.iconUrls[name] = await this.plugin.getIconUrl(name);
      }
    }));

    // 加载数据和背景
    await this.loadData();
    this.bgUrl = await this.plugin.getRandomBgUrl();

    this.render();
    this.loadedIcons = true;
  }

  private async loadData() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    this.txs = await this.dl.readLedger(y, m);
    this.balances = await this.dl.calcAccountBalances();

    // 读全年账本，算年度分类支出
    this.yearlySpending = {};
    for (let mo = 1; mo <= 12; mo++) {
      const monthTxs = await this.dl.readLedger(y, mo);
      for (const tx of monthTxs) {
        if (tx.type === 'expense') {
          this.yearlySpending[tx.category] = (this.yearlySpending[tx.category] || 0) + tx.amount;
        }
      }
    }
  }

  private applyBg(container: HTMLElement) {
    if (this.bgUrl) {
      container.style.backgroundImage = `url(${this.bgUrl})`;
      container.style.backgroundSize = 'cover';
      container.style.backgroundPosition = 'center';
      container.style.backgroundAttachment = 'fixed';
    }
  }

  // ========================
  // RENDER
  // ========================

  private render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    this.applyBg(container);

    // ─── 顶部栏 ─────────────────────────────────
    const topBar = container.createEl('div', { cls: 'fox-top-bar' });

    const logo = topBar.createEl('div', { cls: 'fox-logo-group' });
    this.addIconImg(logo, '星空之狼.png', 'fox-logo-icon');
    logo.createEl('span', { cls: 'fox-logo', text: '狐の财富森林' });

    topBar.createEl('span', { cls: 'fox-mode-pill', text: '月度视图' });

    const bal = this.calcNetAsset();
    const levelText = bal > 50000 ? '🌳 Lv.3' : bal > 10000 ? '🌱 Lv.2' : '🌰 Lv.1';
    const levelPill = topBar.createEl('span', { cls: 'fox-level-pill' });
    this.addIconImg(levelPill, '狼徽盾牌.png', 'fox-level-icon');
    levelPill.append(levelText);

    topBar.createEl('span', { cls: 'fox-star-btn', text: '★' });

    // ★ 金额隐藏切换
    const starBtn = topBar.querySelector('.fox-star-btn') as HTMLElement;
    if (starBtn) {
      starBtn.onclick = () => {
        container.classList.toggle('fox-amounts-hidden');
        starBtn.classList.toggle('fox-star-active');
      };
    }

    // ─── 资产星图 ───────────────────────────────
    const sectionLabel = (parent: HTMLElement, text: string) =>
      parent.createEl('div', { cls: 'fox-section-label', text });

    sectionLabel(container, '资 产 星 图');

    const cardsRow = container.createEl('div', { cls: 'fox-cards-row' });

    this.buildCard(cardsRow, '现金流', 'cash', '幼苗.png', () => {
      return Object.entries(this.balances).filter(([_, v]) => v > 0).slice(0, 3);
    });
    // 现金流卡片点击弹窗查看全部账户
    const cashCard = cardsRow.querySelector('.fox-card-cash') as HTMLElement;
    if (cashCard) {
      cashCard.style.cursor = 'pointer';
      cashCard.onclick = () => new FoxFinanceCashModal(this.app as any, this.plugin, this.balances).open();
    }
    this.buildCard(cardsRow, '投资资产', 'invest', '财富树.png', () => []);
    this.buildCenterCard(cardsRow);
    this.buildCard(cardsRow, '本月预算', 'budget', '财富圆盘.png', () => []);
    this.buildCard(cardsRow, '年度预算', 'budget-yearly', '银河玻璃瓶.png', () => []);
    this.buildCard(cardsRow, '成长投入', 'growth', '银河玻璃瓶.png', () => []);

    // ─── 快速操作 ───────────────────────────────
    sectionLabel(container, '快 速 操 作');

    const actionsBar = container.createEl('div', { cls: 'fox-actions-bar' });

    this.buildActionBtn(actionsBar, '＋ 记一笔', '羽毛账本.png', true, () => {
      this.app.workspace.trigger('fox-finance:quick-add');
    });
    this.buildActionBtn(actionsBar, '查看流水', '星河小路.png', false, () => {
      new FoxFinanceTxModal(this.app as any, this.plugin).open();
    });
    this.buildActionBtn(actionsBar, '资产更新', '发光灯笼.png', false, () => {
      new FoxFinanceAdjustModal(this.app as any, this.plugin).open();
    });
    this.buildActionBtn(actionsBar, '年轮', '星空日历.png', false, () => {
      this.app.workspace.trigger('fox-finance:open-review');
    });
    this.buildActionBtn(actionsBar, '📥 刷新', '', false, () => this.refresh());

    // ─── 近期流水 ───────────────────────────────
    sectionLabel(container, '近 期 流 水');

    const txPanel = container.createEl('div', { cls: 'fox-tx-panel' });

    const headerRow = txPanel.createEl('div', { cls: 'fox-tx-header' });
    ['日期', '类型', '金额', '账户', '分类', '备注'].forEach(h => {
      headerRow.createEl('span', { cls: 'fox-tx-cell', text: h });
    });

    const recent = this.txs.slice(-10).reverse();
    if (recent.length === 0) {
      txPanel.createEl('div', { cls: 'fox-tx-empty', text: '本月还没有流水记录，点击上方「＋ 记一笔」开始记账吧 ✨' });
    } else {
      recent.forEach(tx => {
        const row = txPanel.createEl('div', { cls: 'fox-tx-row' });
        const isNeg = tx.type === 'expense' || tx.type === 'transfer' || tx.type === 'investment_in';
        row.createEl('span', { cls: 'fox-tx-cell', text: tx.date.slice(5) });
        row.createEl('span', { cls: `fox-tx-cell fox-tx-type-${tx.type}`, text: TRANSACTION_TYPE_LABELS[tx.type] || tx.type });
        row.createEl('span', { cls: `fox-tx-cell fox-tx-amount ${isNeg ? 'negative' : 'positive'}`, text: isNeg ? `-${tx.amount.toFixed(2)}` : `+${tx.amount.toFixed(2)}` });
        row.createEl('span', { cls: 'fox-tx-cell', text: tx.account });
        row.createEl('span', { cls: 'fox-tx-cell', text: tx.category });
        row.createEl('span', { cls: 'fox-tx-cell fox-tx-note', text: tx.note || '-' });
      });
    }

    // ─── 底栏 ───────────────────────────────────
    const footer = container.createEl('div', { cls: 'fox-footer-bar' });
    const tabs = ['财富观测台', '流水明细', '账户管理', '年轮', '森林·研究室'];
    tabs.forEach((t, i) => {
      const el = footer.createEl('span', {
        cls: i === 0 ? 'fox-footer-tab fox-footer-tab-active' : 'fox-footer-tab',
        text: t,
      });
      if (i === 1) el.onclick = () => new FoxFinanceTxModal(this.app as any, this.plugin).open();
      if (i === 2) el.onclick = () => this.app.workspace.trigger('fox-finance:open-settings');
      if (i === 3) el.onclick = () => this.app.workspace.trigger('fox-finance:open-review');
    });
    this.addIconImg(footer, '星空之狼.png', 'fox-footer-wolf');
  }

  // ─── Card builders ──────────────────────────────

  private buildCard(
    parent: HTMLElement,
    title: string,
    type: string,
    iconFile: string,
    detailFn: (b: Record<string, number>) => [string, number][],
  ) {
    const card = parent.createEl('div', { cls: `fox-card fox-card-${type}` });
    const titleRow = card.createEl('div', { cls: 'fox-card-title-row' });
    this.addIconImg(titleRow, iconFile, 'fox-card-icon');
    titleRow.createEl('span', { cls: 'fox-card-title', text: title });

    const details = detailFn(this.balances);

    if (type === 'budget') {
      const monthly = (this.plugin.settings?.budgets ?? []).filter((b: any) => b.period === 'monthly');
      const total = monthly.reduce((s: any, b: any) => s + b.amount, 0);
      const spent = this.txs
        .filter(t => t.type === 'expense' && monthly.some((b: any) => b.category === t.category))
        .reduce((s, t) => s + t.amount, 0);
      const pct = total > 0 ? Math.round(spent / total * 100) : 0;

      card.createEl('div', { cls: `fox-card-amount fox-amount-budget`, text: `¥${total.toFixed(2)}` });
      card.createEl('div', { cls: 'fox-card-detail', text: `已用 ${pct}%` });
      const bar = card.createEl('div', { cls: 'fox-progress-bar' });
      bar.createEl('div', { cls: 'fox-progress-fill', attr: { style: `width: ${Math.min(pct, 100)}%` } });
      return;
    }

    if (type === 'budget-yearly') {
      const yearly = (this.plugin.settings?.budgets ?? []).filter((b: any) => b.period === 'yearly');
      const total = yearly.reduce((s: any, b: any) => s + b.amount, 0);
      const spent = yearly.reduce((s: any, b: any) => s + (this.yearlySpending[b.category] || 0), 0);
      const pct = total > 0 ? Math.round(spent / total * 100) : 0;

      card.createEl('div', { cls: `fox-card-amount fox-amount-budget`, text: `¥${total.toFixed(2)}` });
      card.createEl('div', { cls: 'fox-card-detail', text: `已用 ${pct}%` });
      const bar = card.createEl('div', { cls: 'fox-progress-bar' });
      bar.createEl('div', { cls: 'fox-progress-fill', attr: { style: `width: ${Math.min(pct, 100)}%` } });
      if (spent > 0) {
        card.createEl('div', { cls: 'fox-card-change', text: `已花 ¥${spent.toFixed(2)}` });
      }
      return;
    }

    if (type === 'growth') {
      const growth = this.txs
        .filter(t => t.category === '学习')
        .reduce((s, t) => s + t.amount, 0);
      card.createEl('div', { cls: `fox-card-amount fox-amount-growth`, text: `¥${growth.toFixed(2)}` });
      if (details.length) {
        const detailEl = card.createEl('div', { cls: 'fox-card-detail' });
        details.forEach(([name, val]) => {
          detailEl.createEl('div', { cls: 'fox-detail-item', text: `${name}  ${val.toFixed(2)}` });
        });
      }
      return;
    }

    // cash / invest
    let total = 0;
    if (details.length) {
      total = details.reduce((s, [_, v]) => s + v, 0);
    } else if (type === 'invest') {
      for (const [acct, bal] of Object.entries(this.balances)) {
        if (['月月宝', '季季宝', '基金', '股票'].some(k => acct.includes(k))) {
          total += bal;
        }
      }
    }
    card.createEl('div', { cls: `fox-card-amount fox-amount-${type}`, text: `¥${total.toFixed(2)}` });
    if (details.length) {
      const detailEl = card.createEl('div', { cls: 'fox-card-detail' });
      details.forEach(([name, val]) => {
        detailEl.createEl('div', { cls: 'fox-detail-item', text: `${name}  ${val.toFixed(2)}` });
      });
    }
  }

  private buildCenterCard(parent: HTMLElement) {
    const card = parent.createEl('div', { cls: 'fox-card fox-card-center' });
    const titleRow = card.createEl('div', { cls: 'fox-card-title-row' });
    this.addIconImg(titleRow, '星辰水晶球.png', 'fox-card-icon');
    titleRow.createEl('span', { cls: 'fox-card-title', text: '当前净资产' });
    const net = this.calcNetAsset();
    card.createEl('div', { cls: 'fox-card-amount fox-amount-center', text: `¥${net.toFixed(2)}` });
    card.createEl('div', { cls: 'fox-card-change', text: `当前净值` });
  }

  private buildActionBtn(parent: HTMLElement, label: string, iconFile: string, primary: boolean, onClick: () => void) {
    const btn = parent.createEl('button', { cls: `fox-btn ${primary ? 'fox-btn-primary' : ''}` });
    if (iconFile && this.iconUrls[iconFile]) {
      this.addIconImg(btn, iconFile, 'fox-btn-icon');
    }
    btn.createEl('span', { text: label });
    btn.onclick = onClick;
  }

  // ─── Icon helper ──────────────────────────────

  private addIconImg(parent: HTMLElement, filename: string, cls: string) {
    const url = this.iconUrls[filename];
    if (!url) return;
    const img = parent.createEl('img', { cls });
    img.src = url;
    img.alt = filename.replace('.png', '');
  }

  private calcNetAsset(): number {
    return Object.values(this.balances).reduce((s, v) => s + v, 0);
  }
}
