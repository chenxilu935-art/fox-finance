import { App, Modal, Notice } from 'obsidian';
import { FinanceDataLayer } from './finance';
import type FoxFinancePlugin from './main';

export class FoxFinanceAdjustModal extends Modal {
  private dl: FinanceDataLayer;
  private selectedAccount = '';
  private currentBalance = 0;
  private newBalanceStr = '';
  private note = '';

  constructor(
    app: App,
    private plugin: FoxFinancePlugin,
  ) {
    super(app);
    this.dl = new FinanceDataLayer(app);

    const accounts = plugin.settings?.accounts ?? [];
    if (accounts.length) this.selectedAccount = accounts[0].name;
  }

  onOpen() {
    this.modalEl.addClass('fox-finance-modal', 'fox-adjust-modal');
    this.loadBalance();
  }

  private async loadBalance() {
    const all = await this.dl.calcAccountBalances();
    this.currentBalance = all[this.selectedAccount] ?? 0;
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { cls: 'fox-finance-modal-title', text: '✦ 资产更新' });

    // ——— 账户选择 ———
    const accountSetting = contentEl.createDiv({ cls: 'fox-adjust-field' });
    accountSetting.createSpan({ cls: 'fox-adjust-label', text: '账户' });
    const sel = accountSetting.createEl('select', { cls: 'fox-adjust-select' });
    const accounts = this.plugin.settings?.accounts ?? [];
    (accounts.length ? accounts : [{ name: '微信' }, { name: '支付宝' }, { name: '银行卡' }]).forEach((a: any) => {
      const opt = sel.createEl('option');
      opt.value = a.name;
      opt.text = a.name;
      if (a.name === this.selectedAccount) opt.selected = true;
    });
    sel.onchange = async () => {
      this.selectedAccount = sel.value;
      const all = await this.dl.calcAccountBalances();
      this.currentBalance = all[this.selectedAccount] ?? 0;
      this.render();
    };

    // ——— 当前余额（只读） ———
    const currentRow = contentEl.createDiv({ cls: 'fox-adjust-field' });
    currentRow.createSpan({ cls: 'fox-adjust-label', text: '当前余额' });
    currentRow.createSpan({ cls: 'fox-adjust-current', text: `¥${this.currentBalance.toFixed(2)}` });

    // ——— 最新余额 ———
    const newRow = contentEl.createDiv({ cls: 'fox-adjust-field' });
    newRow.createSpan({ cls: 'fox-adjust-label', text: '最新余额' });
    const input = newRow.createEl('input', { cls: 'fox-adjust-input', attr: { type: 'number', step: '0.01', placeholder: '0.00' } });
    if (this.newBalanceStr) input.value = this.newBalanceStr;
    input.oninput = () => { this.newBalanceStr = input.value; };
    input.focus();

    // ——— 备注 ———
    const noteRow = contentEl.createDiv({ cls: 'fox-adjust-field' });
    noteRow.createSpan({ cls: 'fox-adjust-label', text: '备注' });
    const noteInput = noteRow.createEl('input', { cls: 'fox-adjust-input', attr: { placeholder: '选填（如：对账修正）' } });
    if (this.note) noteInput.value = this.note;
    noteInput.oninput = () => { this.note = noteInput.value; };

    // ——— 按钮 ———
    const btnRow = contentEl.createDiv({ cls: 'fox-adjust-actions' });
    const cancelBtn = btnRow.createEl('button', { cls: 'fox-adjust-btn', text: '取消' });
    cancelBtn.onclick = () => this.close();

    const saveBtn = btnRow.createEl('button', { cls: 'fox-adjust-btn fox-adjust-btn-primary', text: '更新' });
    saveBtn.onclick = () => this.save();
  }

  private async save() {
    const amount = parseFloat(this.newBalanceStr);
    if (isNaN(amount) || amount < 0) {
      new Notice('请填写有效的余额');
      return;
    }

    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    await this.dl.appendToLedger({
      date: dateStr,
      type: 'balance_adjust',
      amount,
      account: this.selectedAccount,
      category: '其他',
      subcategory: '',
      note: this.note || `余额调整：¥${amount.toFixed(2)}`,
    });

    new Notice(`✅ ${this.selectedAccount} 余额已更新为 ¥${amount.toFixed(2)}`);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
