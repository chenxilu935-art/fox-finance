import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { FinanceDataLayer, Transaction, TRANSACTION_TYPE_LABELS } from './finance';
import { FoxFinanceTxModal } from './finance-tx-modal';
import type FoxFinancePlugin from './main';

export const VIEW_TYPE_FOX_REVIEW = 'fox-finance-review';

const PIE_COLORS = ['#a78bfa', '#34d399', '#f87171', '#f59e0b', '#60a5fa', '#f472b6', '#2dd4bf', '#fb923c', '#e879f9', '#22d3ee'];

export class FoxFinanceReviewView extends ItemView {
  private dl: FinanceDataLayer;
  private year: number;
  private month: number;
  private txs: Transaction[] = [];
  private balances: Record<string, number> = {};
  private bgUrl = '';
  private _yearlyTxs: Transaction[] | null = null;
  private _yearlyYear: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: FoxFinancePlugin) {
    super(leaf);
    this.dl = new FinanceDataLayer(this.app);
    const d = new Date();
    this.year = d.getFullYear();
    this.month = d.getMonth() + 1;
  }

  getViewType(): string { return VIEW_TYPE_FOX_REVIEW; }
  getDisplayText(): string { return '狐の年轮'; }
  getIcon(): string { return 'calendar'; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('fox-finance-view', 'fox-review-view');

    this.registerEvent(
      this.app.workspace.on('fox-finance:updated', () => this.refresh()),
    );

    await this.refresh();
  }

  async refresh() {
    const container = this.containerEl.children[1] as HTMLElement;
    if (!container) return;

    await this.loadData();
    this.bgUrl = await this.plugin.getRandomBgUrl();
    this.render();
  }

  private async loadData() {
    this.txs = await this.dl.readLedger(this.year, this.month);
    this.balances = await this.dl.calcAccountBalances();
    // 年预算需要全年数据
    if (!this._yearlyTxs || this._yearlyYear !== this.year) {
      this._yearlyTxs = [];
      for (let mo = 1; mo <= 12; mo++) {
        const mt = await this.dl.readLedger(this.year, mo);
        this._yearlyTxs.push(...mt);
      }
      this._yearlyYear = this.year;
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

    // ─── 顶部栏 ─────────────────────────────────────
    const topBar = container.createEl('div', { cls: 'fox-top-bar' });

    const logo = topBar.createEl('div', { cls: 'fox-logo-group' });
    logo.createEl('span', { cls: 'fox-logo', text: '狐の年轮' });

    // 月份导航
    const nav = topBar.createEl('div', { cls: 'fox-review-nav' });
    const prevBtn = nav.createEl('button', { cls: 'fox-review-nav-btn', text: '‹' });
    nav.createEl('span', { cls: 'fox-review-nav-label', text: `${this.year}-${String(this.month).padStart(2, '0')}` });
    const nextBtn = nav.createEl('button', { cls: 'fox-review-nav-btn', text: '›' });
    prevBtn.onclick = () => { this.month--; if (this.month < 1) { this.month = 12; this.year--; } this.refresh(); };
    nextBtn.onclick = () => { this.month++; if (this.month > 12) { this.month = 1; this.year++; } this.refresh(); };

    // 等级
    const levelPill = topBar.createEl('span', { cls: 'fox-level-pill', text: this.getLevelText() });
    const starBtn = topBar.createEl('span', { cls: 'fox-star-btn', text: '★' });
    starBtn.onclick = () => {
      container.classList.toggle('fox-amounts-hidden');
      starBtn.classList.toggle('fox-star-active');
    };

    // ─── 汇总栏 ─────────────────────────────────────
    const income = this.txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = this.txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = income - expense;

    const summary = container.createEl('div', { cls: 'fox-review-summary' });
    summary.createSpan({ cls: 'fox-review-summary-income', text: `📈 收入  ¥${income.toFixed(2)}` });
    summary.createSpan({ cls: 'fox-review-summary-expense', text: `📉 支出  ¥${expense.toFixed(2)}` });
    summary.createSpan({ cls: `fox-review-summary-net ${net >= 0 ? 'positive' : 'negative'}`, text: `📊 结余  ¥${net.toFixed(2)}` });

    if (income > 0) {
      const rate = (net / income * 100);
      summary.createSpan({ cls: `fox-review-summary-rate ${rate >= 30 ? 'positive' : rate < 0 ? 'negative' : ''}`, text: `结余率 ${rate.toFixed(1)}%` });
    }

    // ─── 图表行 ─────────────────────────────────────
    const chartRow = container.createEl('div', { cls: 'fox-review-chart-row' });

    // 左侧：饼图
    const pieBox = chartRow.createEl('div', { cls: 'fox-review-chart-box' });
    pieBox.createEl('div', { cls: 'fox-review-chart-title', text: '支出结构' });
    const pieCanvas = pieBox.createEl('canvas', { cls: 'fox-pie-canvas' });

    // 右侧：柱状图
    const barBox = chartRow.createEl('div', { cls: 'fox-review-chart-box' });
    barBox.createEl('div', { cls: 'fox-review-chart-title', text: '每日支出趋势' });
    const barCanvas = barBox.createEl('canvas', { cls: 'fox-bar-canvas' });

    // ─── 预算追踪 ──────────────────────────────────
    const budgetSection = container.createEl('div', { cls: 'fox-review-section' });
    budgetSection.createEl('div', { cls: 'fox-review-section-title', text: '📋 预算追踪' });

    const budgets = this.plugin.settings?.budgets ?? [];
    if (budgets.length === 0) {
      budgetSection.createEl('div', { cls: 'fox-review-empty', text: '尚未设置预算，前往设置页添加' });
    } else {
      const monthly = budgets.filter((b: any) => b.period === 'monthly');
      const yearly = budgets.filter((b: any) => b.period === 'yearly');

      if (monthly.length > 0) {
        if (yearly.length > 0) budgetSection.createEl('div', { cls: 'fox-review-budget-group-label', text: '月度' });
        for (const b of monthly) {
          this.renderBudgetRow(budgetSection, b, this.txs);
        }
      }

      if (yearly.length > 0) {
        budgetSection.createEl('div', { cls: 'fox-review-budget-group-label', text: '年度' });
        for (const b of yearly) {
          this.renderBudgetRow(budgetSection, b, this._yearlyTxs || this.txs);
        }
      }
    }

    // ─── 账户状态 ───────────────────────────────────
    const acctSection = container.createEl('div', { cls: 'fox-review-section' });
    acctSection.createEl('div', { cls: 'fox-review-section-title', text: '🏦 账户状态' });

    const accounts = this.plugin.settings?.accounts ?? [];
    if (accounts.length === 0) {
      acctSection.createEl('div', { cls: 'fox-review-empty', text: '尚未设置账户，前往设置页添加' });
    } else {
      // 表头
      const headRow = acctSection.createEl('div', { cls: 'fox-review-acct-row fox-review-acct-header' });
      headRow.createSpan({ cls: 'fox-review-acct-name', text: '账户' });
      headRow.createSpan({ cls: 'fox-review-acct-bal', text: '余额' });
      headRow.createSpan({ cls: 'fox-review-acct-income', text: '流入' });
      headRow.createSpan({ cls: 'fox-review-acct-expense', text: '流出' });
      headRow.createSpan({ cls: 'fox-review-acct-change', text: '净变动' });

      for (const acc of accounts) {
        const bal = this.balances[acc.name] ?? 0;
        let inflow = 0, outflow = 0;
        for (const tx of this.txs) {
          if (tx.type === 'balance_adjust') continue; // 余额调整是覆盖，不算流动
          // 流入本账户
          if (tx.account === acc.name && (tx.type === 'income' || tx.type === 'refund')) inflow += tx.amount;
          if (tx.toAccount === acc.name && (tx.type === 'transfer' || tx.type === 'investment_return')) inflow += tx.amount;
          // 流出本账户
          if (tx.account === acc.name && (tx.type === 'expense' || tx.type === 'transfer' || tx.type === 'investment_in')) outflow += tx.amount;
        }
        const netChange = inflow - outflow;

        const row = acctSection.createEl('div', { cls: 'fox-review-acct-row' });
        row.createEl('span', { cls: 'fox-review-acct-name', text: acc.name });
        row.createEl('span', { cls: 'fox-review-acct-bal', text: `¥${bal.toFixed(2)}` });
        row.createEl('span', { cls: 'fox-review-acct-income', text: `流入 ¥${inflow.toFixed(2)}` });
        row.createEl('span', { cls: 'fox-review-acct-expense', text: `流出 ¥${outflow.toFixed(2)}` });
        const changeCls = netChange > 0 ? 'positive' : netChange < 0 ? 'negative' : '';
        row.createEl('span', { cls: `fox-review-acct-change${changeCls ? ' ' + changeCls : ''}`, text: `净变动 ${netChange >= 0 ? '+' : ''}${netChange.toFixed(2)}` });
      }
    }

    // ─── 月度点评 ───────────────────────────────────
    const insightSection = container.createEl('div', { cls: 'fox-review-section' });
    insightSection.createEl('div', { cls: 'fox-review-section-title', text: '📝 月度点评' });

    const points = this.generateReviewPoints(income, expense, budgets);
    if (points.length === 0) {
      insightSection.createEl('div', { cls: 'fox-review-empty', text: '本月暂无数据' });
    } else {
      for (const p of points) {
        insightSection.createEl('div', { cls: 'fox-review-point', text: p });
      }
    }

    // ─── 生成笔记按钮 ───────────────────────────────
    const actionRow = container.createEl('div', { cls: 'fox-review-action-row' });
    const genBtn = actionRow.createEl('button', { cls: 'fox-review-gen-btn', text: '📄 生成年轮笔记 → Finance/年轮/' });
    genBtn.onclick = () => this.generateNote(income, expense, net);

    // ─── 底栏 ───────────────────────────────────────
    const footer = container.createEl('div', { cls: 'fox-footer-bar' });
    const tabs = ['财富观测台', '流水明细', '账户管理', '年轮', '森林·研究室'];
    tabs.forEach((t, i) => {
      const el = footer.createEl('span', {
        cls: i === 3 ? 'fox-footer-tab fox-footer-tab-active' : 'fox-footer-tab',
        text: t,
      });
      if (i === 0) el.onclick = () => this.plugin.activateView();
      if (i === 1) el.onclick = () => new FoxFinanceTxModal(this.app as any, this.plugin).open();
      if (i === 2) el.onclick = () => this.app.workspace.trigger('fox-finance:open-settings');
    });

    // ─── 等 DOM 布局完成后再画 Canvas ─────────────
    requestAnimationFrame(() => {
      this.drawPieChart(pieCanvas);
      this.drawBarChart(barCanvas);
    });
  }

  // ========================
  // CANVAS CHARTS
  // ========================

  private getCategoryData(): { label: string; value: number; color: string }[] {
    const map = new Map<string, number>();
    this.txs.filter(t => t.type === 'expense').forEach(t => {
      map.set(t.category, (map.get(t.category) || 0) + t.amount);
    });
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.map(([label, value], i) => ({ label, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
  }

  private getDailyData(): { day: number; amount: number }[] {
    const days = new Date(this.year, this.month, 0).getDate();
    const daily = new Array(days).fill(0);
    this.txs.filter(t => t.type === 'expense').forEach(t => {
      const day = parseInt(t.date.split('-')[2]);
      if (day >= 1 && day <= days) daily[day - 1] += t.amount;
    });
    return daily.map((amount, i) => ({ day: i + 1, amount }));
  }

  private drawPieChart(canvas: HTMLCanvasElement) {
    const data = this.getCategoryData();
    const total = data.reduce((s, d) => s + d.value, 0);
    const ctx = canvas.getContext('2d');
    if (!ctx || total === 0) return;

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
      const angle = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.arc(cx, cy, innerR, start + angle, start, true);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      start += angle;
    }

    // Legend
    let ly = 8;
    for (const d of data) {
      const pct = Math.round(d.value / total * 100);
      ctx.fillStyle = d.color;
      ctx.fillRect(rect.width * 0.68, ly, 8, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${d.label} ${pct}%`, rect.width * 0.68 + 12, ly + 4);
      ly += 18;
    }
  }

  private drawBarChart(canvas: HTMLCanvasElement) {
    const data = this.getDailyData();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const pad = { t: 6, r: 4, b: 16, l: 32 };
    const w = rect.width - pad.l - pad.r;
    const h = rect.height - pad.t - pad.b;
    const maxVal = Math.max(...data.map(d => d.amount), 1);

    // Bars
    const barW = w / data.length;
    for (const d of data) {
      const barH = (d.amount / maxVal) * h;
      const x = pad.l + (d.day - 1) * barW + 1;
      const y = pad.t + h - barH;
      ctx.fillStyle = d.amount > 0 ? 'rgba(167,139,250,0.7)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(x, y, Math.max(barW - 2, 1), barH);
    }

    // Y-axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('0', 2, pad.t + h - 8);
    ctx.fillText(maxVal.toFixed(0), 2, pad.t + 2);

    // X-axis day markers (every 5 days)
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.textAlign = 'center';
    for (let i = 1; i <= data.length; i += 5) {
      ctx.fillText(String(i), pad.l + (i - 1) * barW + barW / 2, pad.t + h + 2);
    }

    // ─── 鼠标悬停浮层 ───
    // 清除旧浮层（先移除之前添加的）
    const oldTooltip = canvas.parentElement?.querySelector('.fox-bar-tooltip');
    if (oldTooltip) oldTooltip.remove();

    const tooltip = canvas.parentElement!.createDiv({ cls: 'fox-bar-tooltip' });
    tooltip.style.display = 'none';

    canvas.onmousemove = (e) => {
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left - pad.l;
      if (mx < 0 || mx > w) { tooltip.style.display = 'none'; return; }

      const idx = Math.floor(mx / barW);
      if (idx < 0 || idx >= data.length) { tooltip.style.display = 'none'; return; }

      const d = data[idx];
      if (d.amount <= 0) { tooltip.style.display = 'none'; return; }

      const barX = pad.l + idx * barW + barW / 2;
      const barTop = pad.t + h - (d.amount / maxVal) * h;

      tooltip.textContent = `¥${d.amount.toFixed(2)}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${barX}px`;
      tooltip.style.top = `${barTop - 8}px`;
      tooltip.style.transform = 'translate(-50%, -100%)';
    };

    canvas.onmouseleave = () => {
      tooltip.style.display = 'none';
    };
  }

  // ========================
  // REVIEW POINTS
  // ========================

  private generateReviewPoints(income: number, expense: number, budgets: { category: string; amount: number; period: string }[]): string[] {
    const points: string[] = [];

    // 结余率
    if (income > 0) {
      const rate = (income - expense) / income * 100;
      if (rate > 40) points.push(`本月结余率 ${rate.toFixed(1)}%，储蓄习惯健康 👍`);
      else if (rate > 20) points.push(`本月结余率 ${rate.toFixed(1)}%，收支平衡还不错`);
      else if (rate >= 0) points.push(`本月结余率 ${rate.toFixed(1)}%，略有盈余，可关注非必要支出`);
      else points.push(`本月支出超过收入，建议审视开销结构`);
    } else if (expense > 0) {
      points.push('本月没有收入记录，支出全靠存量');
    }

    // 预算超支（月度按当月、年度按全年）
    const monthlyBudgets = budgets.filter((b: any) => b.period === 'monthly');
    const yearlyBudgets = budgets.filter((b: any) => b.period === 'yearly');
    for (const b of monthlyBudgets) {
      if (b.amount <= 0) continue;
      const spent = this.txs.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
      if (spent > b.amount) {
        const over = Math.round((spent - b.amount) / b.amount * 100);
        points.push(`「${b.category}」超预算 ${over}%，实际 ¥${spent.toFixed(0)} / 预算 ¥${b.amount}`);
      } else if (spent <= b.amount * 0.8) {
        points.push(`「${b.category}」控制在预算的 ${Math.round(spent / b.amount * 100)}%，表现不错 ✅`);
      }
    }
    for (const b of yearlyBudgets) {
      if (b.amount <= 0) continue;
      const spent = (this._yearlyTxs || this.txs).filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
      if (spent > b.amount) {
        const over = Math.round((spent - b.amount) / b.amount * 100);
        points.push(`「${b.category}」年度超预算 ${over}%，实际 ¥${spent.toFixed(0)} / 预算 ¥${b.amount}`);
      } else if (spent <= b.amount * 0.8) {
        points.push(`「${b.category}」年度控制在预算的 ${Math.round(spent / b.amount * 100)}%，表现不错 ✅`);
      }
    }

    // 最大支出类别
    const catMap = new Map<string, number>();
    this.txs.filter(t => t.type === 'expense').forEach(t => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
    });
    const totalExp = [...catMap.values()].reduce((s, v) => s + v, 0);
    if (totalExp > 0) {
      const sorted = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      const topPct = Math.round(top[1] / totalExp * 100);
      points.push(`最大支出类别：「${top[0]}」占 ${topPct}%（¥${top[1].toFixed(0)}）`);
    }

    // 投资
    if (this.txs.some(t => t.type === 'investment_in' || t.type === 'investment_return')) {
      points.push('本月有投资操作，持续积累生息资产 🌱');
    }

    // 学习
    const learn = this.txs.filter(t => t.category === '学习').reduce((s, t) => s + t.amount, 0);
    if (learn > 0) points.push(`学习投入 ¥${learn.toFixed(0)}，投资自己是回报率最高的投资 📚`);

    // 笔数
    const days = new Date(this.year, this.month, 0).getDate();
    if (this.txs.length > 0) {
      points.push(`本月共 ${this.txs.length} 笔交易，日均 ${(this.txs.length / days).toFixed(1)} 笔`);
    }

    return points;
  }

  // ========================
  // GENERATE NOTE
  // ========================

  private async generateNote(income: number, expense: number, net: number) {
    const dir = 'Finance/年轮';
    const ym = `${this.year}-${String(this.month).padStart(2, '0')}`;
    const path = `${dir}/${ym}.md`;

    // 确保目录存在
    if (!(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }

    // 支出分类汇总
    const catMap = new Map<string, number>();
    this.txs.filter(t => t.type === 'expense').forEach(t => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
    });
    const totalExp = [...catMap.values()].reduce((s, v) => s + v, 0);
    const catRows = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `| ${cat} | ¥${amt.toFixed(2)} | ${totalExp > 0 ? (amt / totalExp * 100).toFixed(1) + '%' : '-'} |`)
      .join('\n');

    // 预算追踪
    const budgets = this.plugin.settings?.budgets ?? [];
    const monthlyBudgets = budgets.filter((b: any) => b.period === 'monthly');
    const yearlyBudgets = budgets.filter((b: any) => b.period === 'yearly');
    const budgetRows: string[] = [];

    if (monthlyBudgets.length > 0) {
      budgetRows.push('### 月度预算');
      monthlyBudgets.filter((b: any) => b.amount > 0).forEach((b: any) => {
        const spent = this.txs.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
        const pct = Math.round(spent / b.amount * 100);
        budgetRows.push(`| 月度 | ${b.category} | ¥${b.amount.toFixed(0)} | ¥${spent.toFixed(0)} | ${pct}%${pct > 100 ? ' ⚠️' : ''} |`);
      });
    }

    if (yearlyBudgets.length > 0) {
      budgetRows.push('### 年度预算');
      const yearlyTxs = this._yearlyTxs || this.txs;
      yearlyBudgets.filter((b: any) => b.amount > 0).forEach((b: any) => {
        const spent = yearlyTxs.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
        const pct = Math.round(spent / b.amount * 100);
        budgetRows.push(`| 年度 | ${b.category} | ¥${b.amount.toFixed(0)} | ¥${spent.toFixed(0)} | ${pct}%${pct > 100 ? ' ⚠️' : ''} |`);
      });
    }

    // 点评
    const points = this.generateReviewPoints(income, expense, budgets);
    const pointsText = points.map(p => `- ${p}`).join('\n');

    // 结余率
    const rate = income > 0 ? ` | 结余率 | ${((net / income) * 100).toFixed(1)}% |` : '';

    const content = `---
month: ${ym}
income: ${income.toFixed(2)}
expense: ${expense.toFixed(2)}
net: ${net.toFixed(2)}
count: ${this.txs.length}
created: ${new Date().toISOString().slice(0, 10)}
---

# ${ym} · 年轮

## 月度概览

| 项目 | 金额 |
|------|------|
| 收入 | ¥${income.toFixed(2)} |
| 支出 | ¥${expense.toFixed(2)} |
| 结余 | ¥${net.toFixed(2)}${rate}

## 支出分类

| 分类 | 金额 | 占比 |
|------|------|------|
${catRows}

${budgetRows.length > 0 ? `## 预算追踪\n\n| 周期 | 分类 | 预算 | 实际 | 执行率 |\n|------|------|------|------|--------|\n${budgetRows.join('\n')}\n` : ''}## 点评

${pointsText}
`;

    await this.app.vault.adapter.write(path, content);
    new Notice(`✅ 年轮笔记已保存：${path}`);
  }

  // ========================
  // HELPERS
  // ========================

  private renderBudgetRow(parent: HTMLElement, b: any, txs: Transaction[]) {
    const spent = txs
      .filter(t => t.type === 'expense' && t.category === b.category)
      .reduce((s, t) => s + t.amount, 0);
    const pct = b.amount > 0 ? Math.round(spent / b.amount * 100) : 0;
    const over = pct > 100;

    const row = parent.createEl('div', { cls: 'fox-review-budget-row' });
    row.createEl('span', { cls: 'fox-review-budget-label', text: b.category });
    const bar = row.createEl('div', { cls: 'fox-review-budget-bar' });
    bar.createEl('div', {
      cls: `fox-review-budget-fill${over ? ' over' : ''}`,
      attr: { style: `width: ${Math.min(pct, 100)}%` },
    });
    row.createEl('span', {
      cls: `fox-review-budget-text${over ? ' over' : ''}`,
      text: `¥${spent.toFixed(0)} / ¥${b.amount}${over ? ' ⚠️' : ''}`,
    });
  }

  private getLevelText(): string {
    const net = Object.values(this.balances).reduce((s, v) => s + v, 0);
    return net > 50000 ? '🌳 Lv.3' : net > 10000 ? '🌱 Lv.2' : '🌰 Lv.1';
  }
}
