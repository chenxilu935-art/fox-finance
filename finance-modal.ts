import { App, Modal, Setting, Notice } from 'obsidian';
import { FinanceDataLayer, Transaction, TRANSACTION_TYPE_LABELS, TransactionType } from './finance';
import type FoxFinancePlugin from './main';

const TYPE_OPTIONS: TransactionType[] = [
  'expense', 'income', 'transfer', 'investment_in',
  'investment_return', 'refund', 'balance_adjust',
];

export interface EditContext {
  year: string;
  month: string;
  index: number;
  tx: Transaction;
}

export class FoxFinanceModal extends Modal {
  private dl: FinanceDataLayer;

  private tx: Transaction = {
    date: '',
    type: 'expense',
    amount: 0,
    account: '',
    toAccount: '',
    category: '',
    subcategory: '',
    note: '',
  };

  private accounts: string[] = [];
  private categories: { name: string; subcategories: string[]; type: 'income' | 'expense' }[] = [];
  private editContext?: EditContext;
  private tagList: string[] = [];

  constructor(
    app: App,
    private plugin: FoxFinancePlugin,
    private onSave?: () => void,
    editContext?: EditContext,
  ) {
    super(app);
    this.dl = new FinanceDataLayer(app);

    // 从 settings 加载已有账户、分类和标签
    if (plugin?.settings) {
      this.accounts = plugin.settings.accounts?.map((a: any) => a.name) ?? [];
      this.categories = plugin.settings.categories ?? [];
      this.tagList = plugin.settings.tags ?? [];

      // 默认账户
      if (this.accounts.length) this.tx.account = this.accounts[0];
    }

    if (editContext) {
      // 编辑模式：预填数据
      this.editContext = editContext;
      this.tx = { ...editContext.tx };
    } else {
      // 新建模式：默认今天
      const d = new Date();
      this.tx.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('fox-finance-modal');
    contentEl.empty();

    const titleText = this.editContext ? '✎ 编辑交易' : '✦ 记一笔';
    contentEl.createEl('h2', { text: titleText, cls: 'fox-finance-modal-title' });

    // ——— 日期（原生日期选择器） ———
    new Setting(contentEl)
      .setName('日期')
      .addText(t => {
        t.inputEl.type = 'date';
        t.setValue(this.tx.date)
          .onChange(v => this.tx.date = v);
      });

    // ——— 类型 ———
    new Setting(contentEl)
      .setName('类型')
      .addDropdown(d => {
        TYPE_OPTIONS.forEach(t => d.addOption(t, TRANSACTION_TYPE_LABELS[t]));
        d.setValue(this.tx.type)
          .onChange(v => {
            this.tx.type = v as TransactionType;
            this.toggleToAccount(v as TransactionType);
            this.toggleCategory(v as TransactionType);
            // 分类 dropdown 重建：先清空再重新 build
            this.rebuildCategoryDropdown();
            this.rebuildSubcategory();
          });
      });

    // ——— 金额 ———
    new Setting(contentEl)
      .setName('金额')
      .addText(t => t
        .setPlaceholder('0.00')
        .setValue(this.tx.amount ? String(this.tx.amount) : '')
        .onChange(v => {
          this.tx.amount = parseFloat(v) || 0;
        }));

    // ——— 账户 ———
    const accountSetting = new Setting(contentEl)
      .setName('账户')
      .addDropdown(d => this.buildAccountDropdown(d));

    // ——— 目标账户（仅转账/投资时显示） ———
    const toAccountSetting = new Setting(contentEl)
      .setName('目标账户')
      .addDropdown(d => this.buildAccountDropdown(d, true));
    if (!['transfer', 'investment_in', 'investment_return'].includes(this.tx.type)) {
      toAccountSetting.settingEl.addClass('fox-finance-hidden');
    }
    this._toAccountSetting = toAccountSetting;

    // ——— 一级分类 ———
    const catSetting = new Setting(contentEl)
      .setName('分类')
      .addDropdown(d => this.buildCategoryDropdown(d));
    this._catSetting = catSetting;

    // ——— 二级分类 ———
    const subcatSetting = new Setting(contentEl)
      .setName('二级分类')
      .addDropdown(d => this.buildSubcategoryDropdown(d));
    this._subcatSetting = subcatSetting;

    // 初始渲染：根据当前类型显隐目标账户和分类
    this.toggleCategory(this.tx.type);

    // ——— 备注 ———
    new Setting(contentEl)
      .setName('备注')
      .addText(t => t
        .setPlaceholder('选填')
        .setValue(this.tx.note)
        .onChange(v => this.tx.note = v));

    // ——— 标签 ———
    if (this.tagList.length > 0) {
      const tagSetting = new Setting(contentEl)
        .setName('标签')
        .setDesc('点选切换');
      const chipContainer = tagSetting.controlEl.createDiv({ cls: 'fox-tag-chips' });
      this.renderTagChips(chipContainer);
      this._tagChipsEl = chipContainer;
    }

    // ——— 保存 ———
    new Setting(contentEl)
      .addButton(b => b
        .setButtonText('保存')
        .setCta()
        .onClick(() => this.save()));
  }

  // ─── helpers ────────────────────────────────────

  private _toAccountSetting!: Setting;
  private _catSetting!: Setting;
  private _subcatSetting!: Setting;
  private _tagChipsEl!: HTMLElement;

  /** 不需要分类的交易类型 */
  private noCategoryTypes: TransactionType[] = ['transfer', 'investment_in', 'investment_return', 'balance_adjust'];

  private toggleToAccount(type: TransactionType) {
    const show = ['transfer', 'investment_in', 'investment_return'].includes(type);
    this._toAccountSetting?.settingEl.toggleClass('fox-finance-hidden', !show);
  }

  private toggleCategory(type: TransactionType) {
    const hide = this.noCategoryTypes.includes(type);
    this._catSetting?.settingEl.toggleClass('fox-finance-hidden', hide);
    this._subcatSetting?.settingEl.toggleClass('fox-finance-hidden', hide);
  }

  private buildAccountDropdown(d: any, includeEmpty = false) {
    if (includeEmpty) d.addOption('', '—');
    if (!this.accounts.length) {
      d.addOption('现金', '现金');
      d.addOption('微信', '微信');
      d.addOption('支付宝', '支付宝');
      d.addOption('银行卡', '银行卡');
      this.accounts = ['现金', '微信', '支付宝', '银行卡'];
    } else {
      this.accounts.forEach((a: string) => d.addOption(a, a));
    }
    if (includeEmpty) {
      d.setValue('');
    } else {
      d.setValue(this.tx.account || this.accounts[0]);
    }
    d.onChange((v: string) => {
      if (includeEmpty) this.tx.toAccount = v;
      else this.tx.account = v;
    });
    return d;
  }

  private buildCategoryDropdown(d: any) {
    const cats = this.categories.filter(c => {
      if (this.tx.type === 'income') return c.type === 'income';
      if (this.tx.type === 'expense') return c.type === 'expense';
      return true;
    });
    const names = cats.length ? cats.map((c: any) => c.name) : ['餐饮', '交通', '购物', '学习', '娱乐', '居住', '工资', '其他'];
    names.forEach((n: string) => d.addOption(n, n));
    d.setValue(this.tx.category || names[0]);
    d.onChange((v: string) => {
      this.tx.category = v;
      this.rebuildSubcategory();
    });
    return d;
  }

  private buildSubcategoryDropdown(d: any) {
    d.addOption('', '—');
    const cat = this.categories.find((c: any) => c.name === this.tx.category);
    const subs = cat?.subcategories ?? [];
    subs.forEach((s: string) => d.addOption(s, s));
    d.setValue(this.tx.subcategory || '');
    d.onChange((v: string) => this.tx.subcategory = v);
    return d;
  }

  private rebuildSubcategory() {
    if (!this._subcatSetting) return;
    const setting = this._subcatSetting;
    const dropdownEl = setting.controlEl.querySelector('select');
    if (dropdownEl) {
      dropdownEl.empty();
      const d = { addOption: (v: string, l: string) => { const o = document.createElement('option'); o.value = v; o.text = l; dropdownEl.appendChild(o); }, setValue: (v: string) => { dropdownEl.value = v; }, onChange: (cb: (v: string) => void) => { dropdownEl.onchange = () => cb(dropdownEl.value); } };
      this.buildSubcategoryDropdown(d);
    }
  }

  private rebuildCategoryDropdown() {
    if (!this._catSetting) return;
    const setting = this._catSetting;
    const dropdownEl = setting.controlEl.querySelector('select');
    if (dropdownEl) {
      // 重新过滤当前分类：如果当前分类不属于新类型，重置到第一个
      const cats = this.categories.filter(c => {
        if (this.tx.type === 'income') return c.type === 'income';
        if (this.tx.type === 'expense') return c.type === 'expense';
        return true;
      });
      const names = cats.map(c => c.name);
      if (!names.includes(this.tx.category)) {
        this.tx.category = names[0] || '';
      }

      dropdownEl.empty();
      const d = { addOption: (v: string, l: string) => { const o = document.createElement('option'); o.value = v; o.text = l; dropdownEl.appendChild(o); }, setValue: (v: string) => { dropdownEl.value = v; }, onChange: (cb: (v: string) => void) => { dropdownEl.onchange = () => cb(dropdownEl.value); } };
      this.buildCategoryDropdown(d);
    }
  }

  // ─── Tags ────────────────────────────────────────────

  /** 当前选中的标签集合 */
  private get selectedTags(): Set<string> {
    return new Set(this.tx.tags ? this.tx.tags.split(',').map(s => s.trim()).filter(Boolean) : []);
  }

  private renderTagChips(container: HTMLElement) {
    container.empty();
    const selected = this.selectedTags;
    for (const tag of this.tagList) {
      const chip = container.createEl('span', {
        cls: `fox-tag-chip${selected.has(tag) ? ' fox-tag-chip-active' : ''}`,
        text: tag,
      });
      chip.onclick = () => {
        chip.classList.toggle('fox-tag-chip-active');
        this.syncTagsFromChips(container);
      };
    }
  }

  private syncTagsFromChips(container: HTMLElement) {
    const chips = container.querySelectorAll('.fox-tag-chip');
    const active: string[] = [];
    chips.forEach(chip => {
      if (chip.classList.contains('fox-tag-chip-active')) {
        active.push(chip.textContent || '');
      }
    });
    this.tx.tags = active.join(', ');
  }

  private async save() {
    // 校验
    if (!this.tx.date) { new Notice('请填写日期'); return; }
    if (!this.tx.amount || this.tx.amount <= 0) { new Notice('请填写有效金额'); return; }

    // 不需要分类的交易类型自动填默认值
    if (this.noCategoryTypes.includes(this.tx.type)) {
      this.tx.category = '其他';
      this.tx.subcategory = '';
    }

    try {
      if (this.editContext) {
        await this.dl.updateTx(this.editContext.year, this.editContext.month, this.editContext.index, this.tx);
        new Notice('✅ 已更新');
      } else {
        await this.dl.appendToLedger(this.tx);
        new Notice('✅ 已保存');
      }
      this.onSave?.();
      this.close();
    } catch (e) {
      new Notice('❌ 保存失败：' + (e as any).message);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
