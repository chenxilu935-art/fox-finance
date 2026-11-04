# Fox Finance → ZCashflow 数据映射提案

2026-11-03。状态：设计草案，未迁移。Fox证据以architecture-audit.md为准；Z公开源码固定 `f72815344a447d9c5a35265f56a2987ab860999f`（package1.8.0），暂存于D:/CodexTemp/fox-finance-audit-20261103/ZCashflow。公开源码不等于用户已安装数据库版本。

## 约束与真实能力

Z的`src-tauri/migrations/001_init.sql`定义稳定交易ID、正整数amount_minor、交易currency、账户外键、分类树、deleted墓碑和updated_hlc。`src-tauri/src/domain/transactions.rs:11-58`是实际领域DTO（camelCase序列化），包括occurredTime可选；不能把SQL snake_case直接当HTTP JSON契约。领域交易仅income/expense/transfer，Fox七种类型不能无损直接一一对应。

## 普通字段

| Fox | Z目标/桥接提案 | 转换与核对 |
|---|---|---|
| 无ID | Z id / migration map | 由Z领域创建返回UUIDv7；ref只是显示引用。原月文件、快照hash、原行序号组成一次迁移定位，不能当永久业务ID |
| date YYYY-MM-DD | occurredOn | 严格日历日期、明确Asia/Shanghai；旧数据无时分不伪造，occurredTime=null |
| amount:number | amountMinor | 从原始字符串按币种小数位精确转换，不先parseFloat再乘100；超精度/溢出/NaN进审核队列；API对超JS安全整数使用十进制字符串或限制范围 |
| 无交易currency | currency | 用户确认历史币种后映射，不凭¥显示自动判CNY；按账户币种一致性检查；跨币转账第一版阻断 |
| account/toAccount名称 | accountId/toAccountId | 先建立唯一映射表，重名/空名/历史孤立名必须人工处理 |
| category/subcategory | categoryId + parentId树 | 收支kind区分；同名不同父级不能合并；预算引用目标的正确层级 |
| note | note | 原文保留，避免表格pipe二次损坏；title从用户确认规则生成，不把缺title当丢弃理由 |
| tags逗号串 | tags:string[] | trim与空项清理，但保留原串归档；标签名自带逗号存在歧义，应预览 |
| 原始行 | 审计归档/source manifest | 保存源字节定位、hash、转换规则与目标ID；不是第二权威账库 |

## 类型与财务语义（上线阻断项）

| Fox类型 | 候选处理 | 是否可直接迁移 |
|---|---|---|
| income | Z income，正amountMinor、源账户 | 是，币种及分类确认后 |
| expense | Z expense | 是，同上 |
| transfer | Z transfer，强制目标账户存在且不同、同币种 | 是，条件满足后；不能拆成普通收支导致报表翻倍 |
| investment_in | Z transfer + Z内可恢复的语义标识 | 条件性；Fox原余额引擎就是源减目标加，但投资账户无Z investment kind，需kind=other/savings+明确标识，不能将投资功能宣称现成 |
| investment_return | Z income记入Fox.toAccount + 保留原源账户语义 | 必须审核；Fox finance.ts:333-336仅目标加钱，源不减，不能默认映射transfer；若其实是赎回本金需拆分规则并征求确认 |
| refund | Z income可保现金流，但消费/预算语义改变 | 不可直接按普通收入无声转换。优选未来Z新增退款关联/净支出口径；未支持前隔离并保留原类型，不把其计工资或新增财富 |
| balance_adjust | 余额锚点/调整领域的待选方案 | 阻断。Fox是按行序覆盖绝对余额，不能当income或将所有历史adjust简单转openingMinor |

Z `domain/accounts.rs:136-151`的set_balance使用account_balance_anchors，每账户只保单个锚点，余额以日期/created_at门槛计算（:35-59）。它不是多条历史调整事件模型。只迁最后锚点可能保当前余额却破坏历史净值与复盘；五条现存adjust需要逐一设计和影子验证。保留Z为唯一权威的前提下，可选：批准Z最小新增非收支性质调整/语义元数据；或确认通过opening差额重建且单独保存旧历史只读档案。任何方案不能只在Fox私有侧表保留必需财务语义，否则Z导出/恢复后会失真。

## 账户、分类、预算

Z账户kind cash/checking/savings/credit/other（001:6-20），含openingMinor、currency、archived、稳定ID。Fox cash不能一概等于现金，银行卡应用户映射checking，余额类投资可other但不代表持仓估值。账户删除建议先归档；历史引用不可物理删除。

Fox月/年budget映射Z month/year、limitMinor、categoryId、currency（001:111-122）。Z预算统计包含分类子孙及currency条件（domain/budgets.rs:55-82），Fox原先仅按完全相同category名称汇总，迁移后需对齐树级口径，避免父子预算双计。实际BudgetInput没有currency，创建取main_currency、更新不变（:151-176）；桥接不能承诺现成支持任意币种预算写入。

Fox预算无年份/起止与版本，不能推定其适用于全部历史月份；保留旧快照，用户确认生效切换月份。币种不混加；暂无FX时显示分币种，不编造统一净资产。

## 稳定ID、重复与删除

- 一次迁移manifest保存source snapshot hash + original row ordinal → Z ID，重复导入先查manifest/幂等键。相同内容hash只能发现候选，不能折叠两笔合法重复交易。
- 目标创建应支持服务端持久幂等键；重试返回原ID。原字段变更不重新生成ID。不得用日期+金额或Markdown行号作为后续修改/删除定位。
- 删除走Z领域墓碑，不从Markdown缺行推断删除；mirror显示/审核区分“手动移除镜像行”和“申请删除权威交易”。恢复属于新领域操作，需版本与权限，不能简单重发旧行复活。
- Z同步为整行HLC LWW；API应额外暴露revision并进行原子expectedRevision检查。单纯HTTP层比较后再写仍有竞态，需复用同一事务/锁。手机冲突必须可审阅，不能声称现有LWW提供冲突历史。

## 镜像与手动差异（提案）

每个镜像文件标识generated=true、schemaVersion、sourceInstance、snapshotRevision、generatedAt；行携带稳定ID和revision。另存最后一次生成的标准化base快照及文件hash，按ID进行base/本地Markdown/当前Z三方比较。

| 情况 | 动作 |
|---|---|
| 镜像未改、Z改 | 自动替换镜像 |
| 本地改、Z未改 | 展示字段级差异，可选择放弃本地或提交审核 |
| 两边同字段改 | 冲突，禁止自动覆盖；用户选择后带revision写Z |
| 本地增行无ID | 导入草案，预览账户/分类/金额/候选重复，批准后创建 |
| 本地删行 | 仅差异提示，不自动删除权威交易 |
| 本地语法损坏/未知ID | 保留文件，错误定位，不覆盖不丢弃 |

镜像写入采用临时文件+原子替换，预写hash复查并监听自写事件防回环。发现手动修改时保留用户编辑副本或暂停该文件生成，不能“自动镜像”无条件覆盖；批准导入后重新生成。Finance/年轮中的手写感想必须与自动指标分区，生成器只维护标记块，不重写自由正文。旧Finance/Ledger先冻结归档，新镜像建议使用独立Finance/Mirror目录，待用户确认。
