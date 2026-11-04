# Fox Finance 2.0 本地架构审计

审计日：2026-11-03（Asia/Shanghai）。状态：审计事实与升级提案；不授权生产实施。

## 范围、真实位置与版本

- Vault：`D:/Obsidian/OB`。插件与开发源码合一：`D:/Obsidian/OB/.obsidian/plugins/fox-finance`，含 `.git`、TS、CSS、安装入口 `main.js`、已装 `node_modules`。
- 项目资料：`D:/Obsidian/OB/99-Project/FoxFinance/{docs,devlog,scripts}`。本报告仅新建独立文档区，没有改写旧文档。
- origin：`https://github.com/chenxilu935-art/fox-finance.git`。审计起点 HEAD `25369c0`，此前提交 `acf61a6`、`d713752`；起点存在四个已跟踪修改：`finance-review-view.ts`、`finance-view.ts`、`main.js`、`main.ts`。随后按用户对既有四文件的单独提交授权，主智能体报告先快进远端README至f36fa6e，再将四文件提交为12b86a0并推送，main工作区干净。此收尾不代表2.0生产开发已获批准；本审计没有自行执行Git操作。
- manifest 显示 `0.6.1`、minAppVersion `1.4.0`、isDesktopOnly=false；package.json 仍 `0.3.0`，存在版本漂移。不是 Fox 2.0 已实现。
- TS + Obsidian 原生 View/Modal + 原生 CSS/Canvas，esbuild 构建；无额外运行库。package.json 依赖均 devDependencies。不是独立 Web SaaS。
- `main.js` 与以当前 TS、已装 esbuild、external obsidian/electron、format cjs/platform node、write:false 生成的内存 bundle 逐字节一致。SHA256：`b495ab00c9cca5084f118e9e06f35a1f2fc09c873d3d739f3771158608757595`。此结论证明磁盘源码与安装入口相符；未读取 Obsidian 进程内插件对象，不能证明进程已经重载该版本。

## 实际完成度（以行为而非虚构百分比衡量）

| 能力 | 代码状态 | 成熟度边界 |
|---|---|---|
| 交易新增/读取/修改/删除 | 已有真实数据层与UI | 用月份+行序号定位，无稳定ID/并发保护 |
| 财富森林与现金账户 | 已有 View/Modal | 所有余额直接求和、展示人民币，缺汇率/币种隔离 |
| 账户、分类、标签管理 | 设置页已实现 | 名称引用、可直接改名/删除，无引用完整性保障 |
| 月/年分类预算 | 已实现 | 不具有效期版本、调整审计、退款净额语义 |
| 月度年轮、饼图、日趋势、笔记生成 | 已实现 | 月维度功能为主，不能当完整年度分析/净资产历史系统 |
| Inbox | 数据层存在 | 完整预览/审核/批量导入UI仍列待办；不是可靠批处理引擎 |
| 独立数据库/API/Android同步 | Fox 中未实现 | 当前权威实际仍是Markdown |
| Obsidian工作台 | 已对接 | 需维持数据层契约和事件兼容 |

## 当前数据流与耦合

`Modal/View -> FinanceDataLayer -> vault.adapter -> Finance/Ledger/YYYY-MM.md`，写成功后触发 `fox-finance:updated`。设置存插件 `data.json`，交易未使用该文件作为账库。`main.ts:68-72` 初始化数据层并创建账本/Inbox目录。

`finance-modal.ts:47`、`finance-tx-modal.ts:35` 等直接构造 FinanceDataLayer；仅替换 main.ts 的实例不能覆盖全部调用方。未来应让这些入口取得同一 provider，不必重写所有 View。

实际 fox-dashboard `view.ts:1233-1249` 运行时取得 `ff.dataLayer.readLedger/calcAccountBalances`，并监听 `fox-finance:updated`（:47）。旧执行计划称“纯内联”，容易误导为独立解析；当前已委托统一数据层，保留这两个 facade 是最小改造。

## 优先风险与证据

| 等级 | 风险 | 真实依据与影响 |
|---|---|---|
| P0 | 无稳定ID、按索引更新/删除 | finance.ts:111-131；窗口打开后其他写入可使行号改变，误改/误删 |
| P0 | 读全月再覆盖，无锁/版本检测/原子多文件事务 | :97-131；并发创建可能覆盖，整月手写正文被buildLedgerContent替换 |
| P0 | balance_adjust是绝对设值，顺序影响结果 | :213-223、318-345；月文件排序后按原行序应用，未按交易时间重排，补录可改后续余额 |
| P0 | 跨月编辑仍写原月份 | :111-118；修改日期不移动文件；月份查询遗漏或归属错误 |
| P1 | 表格字段未转义、无严格schema | :246-267、288-291；备注含竖线即错列；非法金额变0、未知type未经验证 |
| P1 | Inbox无幂等，追加和标记非事务 | :196-205；崩溃重试/直接重复调用可重复导入；:139-154秒级文件名存在碰撞 |
| P1 | 账户/分类名称作为外键 | main.ts:388-435；设置改名删除不会改历史引用，可能出现孤立账目 |
| P1 | 金额浮点+固定两位/无交易币种 | finance.ts:16-25、288-291；FinanceAccount虽有currency，实际设置账户类型却没有currency（main.ts:12） |
| P1 | 年度缓存同年未失效 | finance-review-view.ts:63-73；同年更新交易时可能继续使用旧_yearlyTxs |
| P2 | 设置加载与保存缺少强schema | main.ts:69、388-478；空名/重复名/负预算等缺统一边界校验 |

## 只读验证结果与限制

使用真实 finance.ts，经已装 TypeScript 内存转译，mock Vault adapter 和 YAML，不写实际账本：

1. 一月交易改为二月日期：一月仍1条、二月0条，复现归属风险。
2. note=`a|b`，tags=`tag` 回读得到note=`a`、tags=`b`，复现错列。
3. 并发 append 两笔，最终只有1笔，复现覆盖。
4. 先追加1月20日收入10，再补1月1日balance_adjust100，结果100；时间顺序回放本应110。此为合成示例，不是用户金额。

`tsc --noEmit --project tsconfig.json` 未通过，TS18003：outDir为当前目录导致默认exclude排除本项目。没有通过修改配置绕开，也未执行会覆盖main.js的build。bundle一致不等于类型检查通过。

最小聚合只读盘点：Ledger 4文件、203行，Inbox 0文件，年轮1文件；交易类型计数balance_adjust5 / expense162 / income27 / transfer8 / investment_in1。按当前表格列数及有限金额检查未发现坏行、未发现文件月份与日期前缀错位；完全相同字段候选7行。候选不能证明重复：可能是合法同日同额同备注交易，绝不能自动删除。未在报告保存真实账户、金额、日期、备注。未完成逐笔会计核对，不能据此认定账本完整无误。

## 文档与代码不一致

- docs/execution-plan.md 顶部0.5.0/Phase3待开始与正文v0.6.1/进行中并存。
- technical-spec.md 列出migrateOldData；实际finance.ts无该方法，不能依赖其作为现成迁移路径。
- 旧文档“不考虑手机端”与manifest非桌面专用并存。2.0建议明确：Fox桌面工作台为本期重点，Android使用Z；不据manifest承诺Fox移动体验。
- “会计精度toFixed(2)”仅是展示格式，不是精确金额存储保证。

## 最小改造边界

保留原生Obsidian插件、View和森林资产；集中FinanceDataLayer/共享provider切换权威来源，新增专用桥接客户端与镜像/审核模块，重用现有事件。不要为了接入改成React或独立Electron壳。迁移、API和视觉重构均在用户批准后独立阶段开展。
