# 本机 API 契约 v0.1（待批准提案）

审计日：2026-11-03。**这些 HTTP 路由当前不存在**。已存在的是固定提交 f72815344a447d9c5a35265f56a2987ab860999f 的 Tauri commands（src-tauri/src/commands/mod.rs），不能由外部 Obsidian 直接 invoke。实现前必须通过 acceptance-tests.md 和本文件能力闸门。

## 传输与认证

仅监听 127.0.0.1 的独立端口；base URL 由用户配对获得，不扫描局域网。只允许合法 Host=127.0.0.1:该端口；若以后增加 IPv6，必须显式 ::1 并同等测试。每个路由包括读请求要求 Authorization: Bearer 随机至少256bit令牌。令牌只给 Fox 专用能力集合，不能复用原生 LAN 配对私钥。禁止URL/query传令牌、Cookie鉴权和 GET 写操作。

配对只能从 ZCashflow 原生可信 UI发起，显示一次性短时配对凭据，在当前用户 ACL 保护的本地通道交换长期令牌。不得以“前端自动获取令牌文件”绕过此步骤。Fox 存储采用 OS secret store 或经验证的 Obsidian secret storage；没有能力时仅会话内输入，重启重新配对。不能保存插件 data.json、Markdown、同步配置或日志。

浏览器 Origin 精确白名单与预检限制仅是附加防护；Electron的 requestUrl/Node可能无 Origin，所以不能把 Origin 当主认证。CORS不允许 * / null 泛白名单。限制JSON content-type、正文大小、批量条数、超时与并发；建议正文1MiB、列表200/页、批量100条，具体值性能验证后冻结。

## 资源与能力

响应统一 camelCase。GET /v1/capabilities 返回 apiVersion、appVersion、migrationVersion、syncSchemaVersion、ledgerEpoch、bridgeBuild、locked、capabilities（含 refund/adjustment/undo 是否可写）。migrationVersion 不得从现有 SCHEMA_VERSION=6 推导，固定源码含九个迁移。ledgerEpoch 在恢复或替换数据集后变更，旧游标/旧幂等作用域失效。

| 提案路由 | 行为 / 现有 Rust 对应 | 备注 |
|---|---|---|
| GET /v1/accounts | accounts::list，带稳定ID及币种/余额/archived | 余额按指定asOf日期 |
| POST /v1/accounts | accounts::upsert（无id） | 增加业务校验/幂等 |
| PUT /v1/accounts/{id} | accounts::upsert（有id） | 条件版本；有历史交易时禁止悄悄改币种 |
| DELETE /v1/accounts/{id} | accounts::delete | 引用检查；优先archived，不级联删交易 |
| GET/POST /v1/categories | categories::list/upsert | parentId层级，循环/同名歧义校验 |
| PUT/DELETE /v1/categories/{id} | categories::upsert/delete | 被引用先归档或提供明确重分配预览 |
| GET/POST /v1/budgets | budgets::list/upsert | 日期、currency显式；现有创建默认主币，需能力闸门 |
| PUT/DELETE /v1/budgets/{id} | budgets::upsert/delete | period day/week/month/year |
| GET /v1/transactions | transactions::list | dateFrom/dateTo/accountId/categoryId/kind/currency/q/cursor |
| GET /v1/transactions/{id} | transactions::get | ETag / revision |
| POST /v1/transactions | transactions::create | 正整数minor，幂等；返回201 |
| PUT /v1/transactions/{id} | transactions::update | 完整可写DTO替换，If-Match必填 |
| DELETE /v1/transactions/{id} | transactions::delete | 墓碑；需版本；返回操作凭据 |
| POST /v1/transactions/{id}/restore | **新增domain能力** | 同ID恢复而非复制新交易；版本条件、权限、引用重新校验 |
| POST /v1/transactions/batch | 现有bulk_update/delete_many只作参考 | 明确all-or-none，逐ID版本/结果，不能静默跳过 |
| GET /v1/snapshot | 一致accounts/categories/budgets/transactions/anchors+cursor | 固定快照分页token，过期重取 |
| GET /v1/changes?cursor=… | 已提交资源变化与tombstone | ledgerEpoch限定；不是同步行协议 |
| GET /v1/operations/{key} | 新增幂等操作查询 | 超时后查结果 |
| POST /v1/import/preview | 审核候选，不写权威财务数据 | 纯解析返回候选可在Fox本地做 |
| POST /v1/import/commit | 通过同一业务写入入口 | 映射/审核hash+幂等batch，不直接写DB |
| GET /v1/summary | period/currency/asOf明确的汇总 | ZCashflow领域口径，transfer排除收支 |
| POST /v1/accounts/{id}/balance-calibration | 当前accounts::set_balance仅作参考 | 默认禁用，不能据此承诺历史balance_adjust等价 |

首轮实现以基础CRUD+快照+状态为最小集合；导入、restore、changes为后续验收能力。Fox需要的功能不满足时明确降级/禁用，不猜语义。

## 交易 DTO（合成例子）

```json
{
  "id": "server-generated-uuid",
  "ref": "TX-2026-000123",
  "kind": "expense",
  "amountMinor": "3500",
  "currency": "CNY",
  "occurredOn": "2026-11-03",
  "occurredTime": null,
  "accountId": "account-uuid",
  "toAccountId": null,
  "categoryId": "category-uuid",
  "title": "午饭",
  "note": null,
  "tags": ["日常"],
  "revision": "opaque-updated-hlc",
  "deleted": false
}
```

- 传输 amountMinor 使用十进制整数字符串，Rust边界解析i64；不让JS number吞掉超过2^53精度。显示金额按币种小数位转换；禁止先浮点乘100再round。现有CNY=2位仍必须用十进制字符串解析。
- 新建客户端不指定财务ID/ref/revision/deviceId；导入来源身份单独记录。id和ref不可互换，跨设备ref可能重复。
- 当前只允许 income/expense/transfer；amountMinor >0。零/负/NaN/越界、无效日期、deleted账户、跨币转账、转给自己、分类kind冲突均拒绝。
- occurredOn 是账务本地日期，不转换UTC导致跨日；occurredTime可空。createdAt为审计时间，不能取代记账日期。asOf默认Asia/Shanghai需与桌面/Android时区一致验证。
- PUT只接受白名单可写字段，不能让调用者传deleted/updatedHlc/SQL。API revision是opaque token，服务端以同一事务检查，再调用接受连接的领域内层函数。
- 退款默认不写入成普通income冒充完整语义；investmentReturn与balanceAdjust能力默认false，映射审批后才开放 semanticKind/关联原交易。不能把所有类型硬改成三种枚举后宣称无损。

## 幂等、事务、冲突

所有POST/PUT/DELETE带 Idempotency-Key，作用域=ledgerEpoch+clientId+key，保存method/path/规范化payloadhash/原状态/结果。相同key同payload返回原结果，不同payload409。幂等记录与财务写入需同一事务持久化；现有schema没有该表，**需要后续批准结构扩展**。不得仅内存缓存后承诺重启不重复。保存期建议至少覆盖迁移和重试窗口（首版90天，待容量验证）；过期键拒绝或显式新操作，不能悄悄重新执行。

更新/删除缺If-Match返回428；版本不符412，返回当前revision与字段差异所需安全数据；已删410（无权限时不暴露存在性）；用户重新确认后新操作键再提交。检查版本与写入必须处于同一锁和同一事务，不能先GET后无条件UPDATE。原生Android HLC LWW覆盖是另一问题，不能用API OCC掩盖。

batch默认all-or-none；任一条失效整批不写，响应逐项原因。不同类型的批量编辑仅允许交集字段，最多100条。导入批次提供映射版本、源hash和每行来源键；相同金额/日期是“疑似重复”，不能自动合并两笔合法消费。

DELETE保留墓碑。撤销需校验删除后的revision、外键及当前权限，禁止把远端较新删除覆盖成旧快照；保存成功前可撤销本地待删状态，持久删除后走restore业务方法。若restore未实现，UI必须写“已删除（暂不支持撤销）”，不展示假撤销。

## 变化流与快照

changes响应包含ledgerEpoch、cursor、hasMore、changes数组；每项resourceType/id/revision/deleted及资源DTO。API游标是opaque，不直接向Fox暴露任意sync表名。现有sync_changes是按(tbl,row_id)保留最新变化的序列，不是不可变历史日志；适合最终状态拉取但不能当审计流水。全量快照末端游标与记录必须在一致事务读取。游标落后到保留窗之外或恢复数据库，返回410 cursorExpired，重新快照；UI在重新装载前保留旧读缓存并显示过期。

## 响应状态和错误

200成功读取/更新；201创建；204删除（Operation-ID响应头提供操作凭据，可经operations查询结果）；400格式；401令牌失效；403权限；409幂等payload冲突/业务约束；410已删/游标失效；412版本冲突；413体积；422字段验证；423锁定；428缺前置条件；429限流；503未就绪/正在恢复；507磁盘满或持久化失败。断连和超时不得转换为“未写入”的确定结论。错误DTO={code,message,fieldErrors,requestId,retryable}，禁止含财务正文/令牌/数据库路径/SQL。

## 实现前验收

虚构账本验证：未授权GET也被拒；跨站/Host欺骗失败；多次同键只一笔；故障在commit/flush/response三个边界均能恢复确认；Android同步删除刷新；并发PUT一个成功一个412；跨币拒绝；snapshot分页期间编辑不漏不重；restore不复活新删除；5000笔导入幂等；解锁/退出/版本变化停止访问；日志无敏感数据。本阶段均未执行。
