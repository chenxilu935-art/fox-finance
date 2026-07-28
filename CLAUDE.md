# Fox Finance 财富系统 — 全馆运营手册

> 狐の财富森林 · 独立插件
> 插件目录：`.obsidian/plugins/fox-finance/`
> 开发目录：`99-Project/FoxFinance/`

---

## 项目定位

Fox Finance 是 Fox Dashboard（狐の工作台）体系中的财富管理插件。它不是传统记账软件，而是一个长期主义的个人财富操作系统。

核心回答三个问题：
1. 我的钱去了哪里？（流水分析）
2. 我现在拥有多少财富？（资产管理）
3. 我的钱是否在帮助我成为更好的自己？（长期复盘）

## 关键原则（Ponytail）

1. **YAGNI** — 不需要的功能就不做
2. **复用** — 先看工作台那边已有的 helper/pattern
3. **标准库** — Obsidian Plugin API 能搞定的就不加依赖
4. **本地优先** — 所有数据存为 Markdown/YAML，不依赖网络
5. **最少代码** — 以上都不行时写最少能跑的代码

## 数据流向

```
用户操作 → Modal/View → FinanceDataLayer → vault 文件（Finance/Ledger/）
                                     ↓
                            workspace.trigger('fox-finance:updated')
                                     ↓
                            工作台卡片收到事件 → 刷新
```

## 文件地图

| 文件 | 职责 |
|------|------|
| `main.ts` | 插件入口、视图注册、命令注册、设置页 |
| `finance.ts` | 数据层（类型、文件 I/O、解析、余额推算） |
| `finance-modal.ts` | 快速记账弹窗 |
| `finance-view.ts` | 狐の财富森林（财富观测台，全屏视图） |
| `finance-review-view.ts` | 狐の年轮（月度复盘看板，全屏视图） |
| `finance-tx-modal.ts` | 流水明细弹窗 |
| `finance-adjust-modal.ts` | 资产更新弹窗 |
| `styles.css` | 全部样式 |
| `manifest.json` | Obsidian 插件元数据 |

## 开发文档

```
99-Project/FoxFinance/
├── scripts/       ← 辅助脚本
├── docs/          ← 需求/设计/技术规范
└── devlog/        ← 开发日志 + 待办
```

## 编译

```bash
cd .obsidian/plugins/fox-finance
npx esbuild main.ts --bundle --outfile=main.js --external:obsidian --external:electron --format=cjs --platform=node
```

## 命名约定

| 项目 | 约定 |
|------|------|
| CSS 类前缀 | `.fox-finance-*`（复用手台表的 `--fox-*` 变量） |
| 视图类型 | `fox-finance-dashboard` |
| 事件名 | `fox-finance:updated` `fox-finance:inbox-added` |
| 命令 ID | `fox-finance:quick-add` `fox-finance:open-dashboard` |

## 开工检查清单

> 每次新对话开始时，做这几件事：

1. ✅ 读本手册（CLAUDE.md）
2. ✅ 读 `99-Project/FoxFinance/claudian-memory.md`（我的工作记忆）
3. ✅ 读 `99-Project/FoxFinance/devlog/` 最新日志
4. ✅ 读 `99-Project/FoxFinance/docs/execution-plan.md` 当前进度

## 收工检查清单（小狐说「收工」时必做）

当小狐说「收工」、「今天就到这」或类似的话时，我立即执行以下 6 步：

1. **写开发日志**：`99-Project/FoxFinance/devlog/YYYY-MM-DD.md`
2. **更新执行计划**：`99-Project/FoxFinance/docs/execution-plan.md` — 标记完成项、推进版本号
3. **更新速查手册**：`99-Project/FoxFinance/docs/dev-quickref.md` — 新模块加入文件地图
4. **更新版本号**：`manifest.json` 版本号 +1
5. **更新工作记忆**：`99-Project/FoxFinance/claudian-memory.md`（我的专属记忆，不碰根目录 memory.md）
6. **编译验证**：`npx esbuild main.ts ...` 确认通过
