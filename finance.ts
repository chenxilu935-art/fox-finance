import { parseYaml, stringifyYaml } from 'obsidian';

// ========================
// Types
// ========================

export type TransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'investment_in'
  | 'investment_return'
  | 'refund'
  | 'balance_adjust';

export interface Transaction {
  date: string;        // YYYY-MM-DD
  type: TransactionType;
  amount: number;
  account: string;
  toAccount?: string;  // for transfer / investment_in / investment_return
  category: string;
  subcategory: string;
  note: string;
  tags: string;        // 逗号分隔，如 "工作, 差旅"
}

export interface FinanceAccount {
  name: string;
  type: 'cash' | 'investment';
  balance: number;
  currency: string;
}

export interface FinanceCategory {
  name: string;
  type: 'income' | 'expense';
  subcategories: string[];
}

export interface FinanceBudget {
  category: string;
  amount: number;
  period: 'monthly' | 'yearly';
}

// ========================
// Constants
// ========================

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '账户转移',
  investment_in: '投资投入',
  investment_return: '投资收益',
  refund: '退款',
  balance_adjust: '余额调整',
};

const LEDGER_DIR = 'Finance/Ledger';
const INBOX_DIR = 'Finance/Inbox';

const TABLE_HEADER = '| date | type | amount | account | toAccount | category | subcategory | note | tags |';
const TABLE_SEP   = '|------|------|--------|---------|-----------|----------|-------------|------|------|';

// ========================
// Data Layer
// ========================

export class FinanceDataLayer {
  constructor(private app: any) {}

  private get adapter() {
    return this.app.vault.adapter;
  }

  // ─── Directories ─────────────────────────────────

  async ensureDirectories(): Promise<void> {
    for (const dir of [LEDGER_DIR, INBOX_DIR]) {
      if (!(await this.adapter.exists(dir))) {
        await this.adapter.mkdir(dir);
      }
    }
  }

  // ─── Ledger ──────────────────────────────────────

  /** 读取某个月的账本流水 */
  async readLedger(year: string | number, month: string | number): Promise<Transaction[]> {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return this.readLedgerFile(`${LEDGER_DIR}/${ym}.md`);
  }

  /** 向账本追加一笔交易，自动更新 frontmatter 汇总 */
  async appendToLedger(tx: Transaction): Promise<void> {
    const [year, month] = tx.date.split('-');
    if (!year || !month) throw new Error(`Invalid transaction date: ${tx.date}`);

    const existing = await this.readLedger(year, month);
    existing.push(tx);

    const content = this.buildLedgerContent(year, month, existing);
    await this.adapter.write(`${LEDGER_DIR}/${year}-${month}.md`, content);

    this.app.workspace.trigger('fox-finance:updated');
  }

  /** 修改账本某月的第 index 笔交易（0-based） */
  async updateTx(year: string, month: string, index: number, tx: Transaction): Promise<void> {
    const existing = await this.readLedger(year, month);
    if (index < 0 || index >= existing.length) throw new Error(`Transaction index ${index} out of range`);

    existing[index] = tx;

    const content = this.buildLedgerContent(year, month, existing);
    await this.adapter.write(`${LEDGER_DIR}/${year}-${month}.md`, content);

    this.app.workspace.trigger('fox-finance:updated');
  }

  /** 删除账本某月的第 index 笔交易（0-based） */
  async deleteTx(year: string, month: string, index: number): Promise<void> {
    const existing = await this.readLedger(year, month);
    if (index < 0 || index >= existing.length) throw new Error(`Transaction index ${index} out of range`);

    existing.splice(index, 1);

    const content = this.buildLedgerContent(year, month, existing);
    await this.adapter.write(`${LEDGER_DIR}/${year}-${month}.md`, content);

    this.app.workspace.trigger('fox-finance:updated');
  }

  // ─── Inbox ───────────────────────────────────────

  /** 创建一条暂存箱记录（单文件 YAML frontmatter） */
  async createInboxFile(tx: Transaction): Promise<string> {
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const path = `${INBOX_DIR}/${ts}.md`;

    const data: Record<string, any> = { ...tx, imported: false };
    if (!data.toAccount) data.toAccount = null;

    const yaml = stringifyYaml(data);
    const label = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;

    const content = [
      '---',
      yaml.trim(),
      '---',
      '',
      `# ${label}：${tx.amount.toFixed(2)}`,
      '',
      `**账户**：${tx.account}${tx.toAccount ? ' → ' + tx.toAccount : ''}`,
      `**分类**：${tx.category} / ${tx.subcategory}`,
      tx.note ? `**备注**：${tx.note}` : '',
    ].filter(Boolean).join('\n');

    await this.adapter.write(path, content);
    this.app.workspace.trigger('fox-finance:inbox-added');

    return path;
  }

  /** 扫描暂存箱，返回所有未导入的记录 */
  async scanInbox(): Promise<{ path: string; tx: Transaction }[]> {
    const results: { path: string; tx: Transaction }[] = [];
    try {
      const { files } = await this.adapter.list(INBOX_DIR);
      for (const file of files.filter((f: string) => f.endsWith('.md')).sort()) {
        const content = await this.adapter.read(file);
        const { frontmatter } = this.parseFrontmatter(content);
        if (!frontmatter || frontmatter.imported) continue;

        results.push({
          path: file,
          tx: this.frontmatterToTx(frontmatter),
        });
      }
    } catch (_) { /* inbox dir may not exist */ }
    return results;
  }

  /** 导入一条暂存箱记录 → 追加到账本，标记已导入 */
  async importInbox(filePath: string): Promise<void> {
    const content = await this.adapter.read(filePath);
    const { frontmatter, body } = this.parseFrontmatter(content);
    if (!frontmatter) throw new Error('Invalid inbox file (no frontmatter)');

    await this.appendToLedger(this.frontmatterToTx(frontmatter));

    frontmatter.imported = true;
    const newYaml = stringifyYaml(frontmatter);
    await this.adapter.write(filePath, `---\n${newYaml.trim()}\n---\n${body}`);

    this.app.workspace.trigger('fox-finance:updated');
  }

  // ─── Balances ────────────────────────────────────

  /** 遍历所有账本文件，推算每个账户的当前余额 */
  async calcAccountBalances(): Promise<Record<string, number>> {
    const balances: Record<string, number> = {};
    const { files } = await this.adapter.list(LEDGER_DIR);

    for (const file of files.filter((f: string) => f.endsWith('.md')).sort()) {
      const txs = await this.readLedgerFile(file);
      for (const tx of txs) {
        this.applyTx(balances, tx);
      }
    }

    return balances;
  }

  // ─── Private: file helpers ───────────────────────

  private async readLedgerFile(path: string): Promise<Transaction[]> {
    if (!(await this.adapter.exists(path))) return [];
    const content = await this.adapter.read(path);
    const { body } = this.parseFrontmatter(content);
    if (!body) return [];
    return this.parseLedgerTable(body);
  }

  private parseFrontmatter(content: string): { frontmatter: Record<string, any> | null; body: string } {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!m) return { frontmatter: null, body: content };
    return {
      frontmatter: parseYaml(m[1]),
      body: content.slice(m[0].length),
    };
  }

  private parseLedgerTable(body: string): Transaction[] {
    return body
      .split('\n')
      .filter(l => l.trim().startsWith('|'))
      .slice(2) // skip header + separator
      .map(line => {
        // split('|') 首尾是空串，slice(1,-1) 取中间实际列
        const c = line.split('|').slice(1, -1).map(s => s.trim());
        if (c.length < 7) return null;
        return {
          date: c[0],
          type: c[1] as TransactionType,
          amount: parseFloat(c[2]) || 0,
          account: c[3],
          toAccount: c[4] === '-' ? undefined : c[4],
          category: c[5],
          subcategory: c[6],
          note: c[7] || '',
          tags: c[8] || '', // 向后兼容：旧行无 tags 列
        } as Transaction;
      })
      .filter((tx): tx is Transaction => tx !== null);
  }

  private buildLedgerContent(year: string, month: string, txs: Transaction[]): string {
    const income  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    const yaml = stringifyYaml({
      month: `${year}-${month}`,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
      count: txs.length,
    });

    const rows = txs.map(t => {
      const to = t.toAccount || '-';
      const tags = t.tags || '';
      return `| ${t.date} | ${t.type} | ${t.amount.toFixed(2)} | ${t.account} | ${to} | ${t.category} | ${t.subcategory} | ${t.note} | ${tags} |`;
    });

    return [
      '---',
      yaml.trim(),
      '---',
      '',
      '## 账本流水',
      '',
      TABLE_HEADER,
      TABLE_SEP,
      ...rows,
      '',
    ].join('\n');
  }

  private frontmatterToTx(fm: Record<string, any>): Transaction {
    return {
      date: fm.date || '',
      type: fm.type || 'expense',
      amount: Number(fm.amount) || 0,
      account: fm.account || '',
      toAccount: fm.toAccount || undefined,
      category: fm.category || '其他',
      subcategory: fm.subcategory || '',
      note: fm.note || '',
      tags: fm.tags || '',
    };
  }

  // ─── Private: balance engine ─────────────────────

  private applyTx(b: Record<string, number>, tx: Transaction): void {
    switch (tx.type) {
      case 'income':
        b[tx.account] = (b[tx.account] || 0) + tx.amount;
        break;
      case 'expense':
        b[tx.account] = (b[tx.account] || 0) - tx.amount;
        break;
      case 'transfer':
      case 'investment_in':
        b[tx.account] = (b[tx.account] || 0) - tx.amount;
        if (tx.toAccount) {
          b[tx.toAccount] = (b[tx.toAccount] || 0) + tx.amount;
        }
        break;
      case 'investment_return':
        if (tx.toAccount) {
          b[tx.toAccount] = (b[tx.toAccount] || 0) + tx.amount;
        }
        break;
      case 'refund':
        b[tx.account] = (b[tx.account] || 0) + tx.amount;
        break;
      case 'balance_adjust':
        b[tx.account] = tx.amount;
        break;
    }
  }
}

// ========================
// Utility
// ========================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
