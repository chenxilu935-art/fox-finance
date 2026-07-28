import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { FinanceDataLayer } from './finance';
import { FoxFinanceModal } from './finance-modal';
import { FoxFinanceView, VIEW_TYPE_FOX_FINANCE } from './finance-view';
import { FoxFinanceReviewView, VIEW_TYPE_FOX_REVIEW } from './finance-review-view';

// ========================
// Settings
// ========================

interface FoxFinanceSettings {
  accounts: { name: string; type: 'cash' | 'investment' }[];
  categories: { name: string; type: 'income' | 'expense'; subcategories: string[] }[];
  budgets: { category: string; amount: number; period: 'monthly' | 'yearly' }[];
  bgTheme: 'galaxy' | 'glasshouse' | 'custom';
  /** vault 相对路径的自定义背景图片列表 */
  customBgPaths: string[];
  tags: string[];
}

const DEFAULT_SETTINGS: FoxFinanceSettings = {
  accounts: [
    { name: '微信', type: 'cash' },
    { name: '支付宝', type: 'cash' },
    { name: '银行卡', type: 'cash' },
    { name: '月月宝', type: 'investment' },
    { name: '季季宝', type: 'investment' },
  ],
  categories: [
    { name: '餐饮', type: 'expense', subcategories: ['三餐', '外卖', '饮品', '零食'] },
    { name: '交通', type: 'expense', subcategories: ['地铁', '打车', '加油', '共享单车'] },
    { name: '购物', type: 'expense', subcategories: ['日用', '衣物', '数码', '家居'] },
    { name: '学习', type: 'expense', subcategories: ['课程', '书籍', '文具'] },
    { name: '娱乐', type: 'expense', subcategories: ['电影', '游戏', '旅行', '社交'] },
    { name: '居住', type: 'expense', subcategories: ['房租', '水电', '网络', '物业'] },
    { name: '医疗', type: 'expense', subcategories: ['门诊', '药品', '体检'] },
    { name: '其他', type: 'expense', subcategories: ['其他'] },
    { name: '工资', type: 'income', subcategories: ['实习', '兼职', '奖金'] },
    { name: '其他收入', type: 'income', subcategories: ['红包', '退款', '其他'] },
  ],
  budgets: [
    { category: '餐饮', amount: 1500, period: 'monthly' },
    { category: '交通', amount: 300, period: 'monthly' },
    { category: '学习', amount: 500, period: 'monthly' },
  ],
  bgTheme: 'galaxy',
  customBgPaths: [],
  tags: ['工作', '差旅', '个人'],
};

const BG_POOLS: Record<string, string[]> = {
  galaxy: ['银河森林.png', '银河森林2.png'],
  glasshouse: ['森林玻璃屋.png', '森林玻璃屋2.png'],
};

const ASSET_ROOT = '.obsidian/plugins/fox-finance/Asset/';

// ========================
// Plugin
// ========================

export default class FoxFinancePlugin extends Plugin {
  settings: FoxFinanceSettings = DEFAULT_SETTINGS;
  dataLayer!: FinanceDataLayer;

  private blobCache = new Map<string, string>();

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.dataLayer = new FinanceDataLayer(this.app);

    await this.dataLayer.ensureDirectories();

    this.registerView(
      VIEW_TYPE_FOX_FINANCE,
      (leaf) => new FoxFinanceView(leaf, this),
    );
    this.registerView(
      VIEW_TYPE_FOX_REVIEW,
      (leaf) => new FoxFinanceReviewView(leaf, this),
    );

    this.addCommand({
      id: 'fox-finance:open-dashboard',
      name: '打开财富森林看板',
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: 'fox-finance:quick-add',
      name: '记一笔（快速记账）',
      callback: () => this.openQuickAddModal(),
    });

    this.registerEvent(
      this.app.workspace.on('fox-finance:quick-add', () => this.openQuickAddModal()),
    );
    this.registerEvent(
      this.app.workspace.on('fox-finance:open-settings', () => {
        (this.app as any).setting.open();
        (this.app as any).setting.openTabById('fox-finance');
      }),
    );
    this.registerEvent(
      this.app.workspace.on('fox-finance:open-review', () => this.activateReviewView()),
    );

    this.addRibbonIcon('wallet', 'Fox Finance', () => this.activateView());
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
      if (!leaf) return;
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
      if (!leaf) return;
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
      if (leaf?.view instanceof FoxFinanceView) leaf.view.refresh();
    }).open();
  }

  // ─── Assets ─────────────────────────────────────

  /** 读取 Asset 目录下文件，返回 blob:// URL */
  async readAsset(subpath: string): Promise<string> {
    const cached = this.blobCache.get(subpath);
    if (cached) return cached;

    const fullPath = ASSET_ROOT + subpath;
    try {
      const data = await this.app.vault.adapter.readBinary(fullPath);
      const blob = new Blob([data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      this.blobCache.set(subpath, url);
      return url;
    } catch {
      return '';
    }
  }

  /** 读取 vault 中任意路径的图片，返回 blob:// URL */
  async readVaultFile(path: string): Promise<string> {
    const key = `vault:${path}`;
    const cached = this.blobCache.get(key);
    if (cached) return cached;

    try {
      const data = await this.app.vault.adapter.readBinary(path);
      const ext = path.split('.').pop()?.toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : ext === 'webp' ? 'image/webp'
                 : 'image/png';
      const blob = new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      this.blobCache.set(key, url);
      return url;
    } catch {
      return '';
    }
  }

  /** 获取背景图 URL（内置图片 + 自定义图片随机轮换） */
  async getRandomBgUrl(): Promise<string> {
    // 收集所有可用背景
    const pool: string[] = [];

    if (this.settings.bgTheme === 'custom') {
      // 只用自定义
      for (const p of this.settings.customBgPaths) {
        const url = await this.readVaultFile(p);
        if (url) pool.push(url);
      }
      if (pool.length === 0) {
        new Notice('未设置自定义背景图，请在主题设置中选择内置主题或添加图片路径');
        return '';
      }
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // 内置主题
    const themePool = BG_POOLS[this.settings.bgTheme];
    if (themePool) {
      for (const f of themePool) {
        const url = await this.readAsset(`background/${f}`);
        if (url) pool.push(url);
      }
    }
    // 混入自定义背景（如果有）
    if (this.settings.bgTheme !== 'custom') {
      for (const p of this.settings.customBgPaths) {
        const url = await this.readVaultFile(p);
        if (url) pool.push(url);
      }
    }

    if (pool.length === 0) return '';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** 获取图标 URL */
  async getIconUrl(name: string): Promise<string> {
    return this.readAsset(`icons/${name}`);
  }
}

// ========================
// Setting Tab
// ========================

class FoxFinanceSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: FoxFinancePlugin) {
    super(app, plugin);
  }

  get p(): FoxFinancePlugin { return this.plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '✦ Fox Finance 设置' });

    // ─── 背景主题 ────────────────────────────────
    containerEl.createEl('h3', { text: '背景主题' });
    new Setting(containerEl)
      .setName('背景主题')
      .setDesc('选择内置主题，或选"自定义"使用下方添加的图片')
      .addDropdown(d => {
        d.addOption('galaxy', '🌌 银河森林');
        d.addOption('glasshouse', '🏡 森林玻璃屋');
        d.addOption('custom', '🖼️ 自定义');
        d.setValue(this.p.settings.bgTheme);
        d.onChange(async v => {
          this.p.settings.bgTheme = v as 'galaxy' | 'glasshouse' | 'custom';
          await this.p.saveData(this.p.settings);
          this.display(); // 刷新页面，显示/隐藏自定义背景列表
          this.p.activateView();
        });
      });

    // 自定义背景图片管理（仅 custom 模式显示完整列表，其他模式也显示以便添加）
    containerEl.createEl('h4', { text: '自定义背景图片' });
    const bgDesc = containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '添加 vault 内的图片路径（如 "附件的图片/森林.png"），设置页和看板都会随机轮换',
    });
    bgDesc.style.margin = '0 0 12px';

    const bgList = containerEl.createDiv();
    this.renderBgPathList(bgList);

    new Setting(containerEl)
      .addButton(b => b.setButtonText('＋ 添加图片路径').setCta().onClick(async () => {
        this.p.settings.customBgPaths.push('');
        await this.p.saveData(this.p.settings);
        this.display();
      }));

    // ─── 账户管理 ────────────────────────────────
    containerEl.createEl('h3', { text: '账户管理' });
    const accountList = containerEl.createDiv();
    this.renderAccountList(accountList);
    new Setting(containerEl)
      .addButton(b => b.setButtonText('＋ 添加账户').setCta().onClick(async () => {
        this.p.settings.accounts.push({ name: '', type: 'cash' });
        await this.p.saveData(this.p.settings);
        this.display();
      }));

    // ─── 分类管理 ────────────────────────────────
    containerEl.createEl('h3', { text: '分类管理' });
    const catList = containerEl.createDiv();
    this.renderCategoryList(catList);
    new Setting(containerEl)
      .addButton(b => b.setButtonText('＋ 添加分类').setCta().onClick(async () => {
        this.p.settings.categories.push({ name: '', type: 'expense', subcategories: ['其他'] });
        await this.p.saveData(this.p.settings);
        this.display();
      }));

    // ─── 预算 ────────────────────────────────────
    containerEl.createEl('h3', { text: '预算' });
    const budgetList = containerEl.createDiv();
    this.renderBudgetList(budgetList);
    new Setting(containerEl)
      .addButton(b => b.setButtonText('＋ 添加预算').setCta().onClick(async () => {
        const firstCat = this.p.settings.categories.find(c => c.type === 'expense');
        this.p.settings.budgets.push({ category: firstCat?.name || '', amount: 0, period: 'monthly' });
        await this.p.saveData(this.p.settings);
        this.display();
      }));

    // ─── 标签管理 ────────────────────────────────────
    containerEl.createEl('h3', { text: '标签管理' });
    containerEl.createEl('p', { cls: 'setting-item-description', text: '给交易打标签，方便按场景筛选（如"工作"相关的打车费）' });
    const tagList = containerEl.createDiv();
    this.renderTagList(tagList);
    new Setting(containerEl)
      .addButton(b => b.setButtonText('＋ 添加标签').setCta().onClick(async () => {
        this.p.settings.tags.push('');
        await this.p.saveData(this.p.settings);
        this.display();
      }));

    // ─── 保存按钮 ──────────────────────────────────
    containerEl.createEl('hr');
    new Setting(containerEl)
      .addButton(b => b
        .setButtonText('💾 保存设置')
        .setCta()
        .onClick(async () => {
          await this.p.saveData(this.p.settings);
          new Notice('✅ 设置已保存');
        }));
  }

  // ─── Background Path List ──────────────────────────

  private renderBgPathList(el: HTMLElement) {
    const paths = this.p.settings.customBgPaths;
    if (paths.length === 0) {
      el.createEl('p', { cls: 'fox-sub-empty', text: '尚未添加自定义背景图片' });
      return;
    }

    paths.forEach((p, i) => {
      const s = new Setting(el)
        .addText(t => t
          .setPlaceholder('附件的图片/风景.png')
          .setValue(p)
          .onChange(async v => {
            paths[i] = v;
            await this.p.saveData(this.p.settings);
          }))
        .addButton(b => b.setIcon('trash').setWarning().onClick(async () => {
          paths.splice(i, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        }));
      s.settingEl.addClass('fox-setting-row');
    });
  }

  // ─── Account List ────────────────────────────────

  private renderAccountList(el: HTMLElement) {
    this.p.settings.accounts.forEach((acc, i) => {
      const s = new Setting(el)
        .addText(t => t.setPlaceholder('账户名称').setValue(acc.name)
          .onChange(async v => { this.p.settings.accounts[i].name = v; await this.p.saveData(this.p.settings); }))
        .addDropdown(d => d.addOption('cash', '现金账户').addOption('investment', '投资账户').setValue(acc.type)
          .onChange(async v => { this.p.settings.accounts[i].type = v as 'cash' | 'investment'; await this.p.saveData(this.p.settings); }))
        .addButton(b => b.setIcon('trash').setWarning().onClick(async () => {
          this.p.settings.accounts.splice(i, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        }));
      s.settingEl.addClass('fox-setting-row');
    });
  }

  // ─── Category List ──────────────────────────────

  private renderCategoryList(el: HTMLElement) {
    this.p.settings.categories.forEach((cat, i) => {
      const s = new Setting(el)
        .addText(t => t.setPlaceholder('分类名称').setValue(cat.name)
          .onChange(async v => { this.p.settings.categories[i].name = v; await this.p.saveData(this.p.settings); }))
        .addDropdown(d => d.addOption('expense', '支出').addOption('income', '收入').setValue(cat.type)
          .onChange(async v => { this.p.settings.categories[i].type = v as 'expense' | 'income'; await this.p.saveData(this.p.settings); }))
        .addButton(b => b.setIcon('plus-circle').setTooltip('添加子分类').onClick(() => {
          this.p.settings.categories[i].subcategories.push('');
          this.display();
        }))
        .addButton(b => b.setIcon('trash').setWarning().onClick(async () => {
          this.p.settings.categories.splice(i, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        }));

      const subEl = el.createDiv({ cls: 'fox-setting-subs' });
      cat.subcategories.forEach((sub, j) => {
        const tag = subEl.createSpan({ cls: 'fox-sub-tag' });
        const input = tag.createEl('input', { cls: 'fox-sub-input', attr: { placeholder: '子分类名称', value: sub } });
        input.onchange = async () => {
          cat.subcategories[j] = input.value;
          await this.p.saveData(this.p.settings);
        };
        const delBtn = tag.createEl('span', { cls: 'fox-sub-del', text: '✕' });
        delBtn.onclick = async () => {
          cat.subcategories.splice(j, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        };
      });
      if (cat.subcategories.length === 0) {
        subEl.createSpan({ cls: 'fox-sub-empty', text: '无子分类' });
      }
    });
  }

  // ─── Budget List ────────────────────────────────

  private renderBudgetList(el: HTMLElement) {
    this.p.settings.budgets.forEach((budget, i) => {
      const s = new Setting(el)
        .addDropdown(d => {
          const expenseCats = this.p.settings.categories.filter(c => c.type === 'expense');
          (expenseCats.length ? expenseCats : [{ name: '餐饮' }, { name: '交通' }]).forEach((c: any) => d.addOption(c.name, c.name));
          d.setValue(budget.category);
          d.onChange(async v => { this.p.settings.budgets[i].category = v; await this.p.saveData(this.p.settings); });
        })
        .addText(t => t.setPlaceholder('金额').setValue(String(budget.amount || ''))
          .onChange(async v => { this.p.settings.budgets[i].amount = parseFloat(v) || 0; await this.p.saveData(this.p.settings); }))
        .addDropdown(d => d.addOption('monthly', '月').addOption('yearly', '年').setValue(budget.period)
          .onChange(async v => { this.p.settings.budgets[i].period = v as 'monthly' | 'yearly'; await this.p.saveData(this.p.settings); }))
        .addButton(b => b.setIcon('trash').setWarning().onClick(async () => {
          this.p.settings.budgets.splice(i, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        }));
      s.settingEl.addClass('fox-setting-row');
    });
  }

  // ─── Tag List ─────────────────────────────────────

  private renderTagList(el: HTMLElement) {
    this.p.settings.tags.forEach((tag, i) => {
      const s = new Setting(el)
        .addText(t => t.setPlaceholder('标签名称').setValue(tag)
          .onChange(async v => { this.p.settings.tags[i] = v; await this.p.saveData(this.p.settings); }))
        .addButton(b => b.setIcon('trash').setWarning().onClick(async () => {
          this.p.settings.tags.splice(i, 1);
          await this.p.saveData(this.p.settings);
          this.display();
        }));
      s.settingEl.addClass('fox-setting-row');
    });
  }
}
