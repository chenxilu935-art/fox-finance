# ZCashflow 集成架构提案

状态：2026-11-03 只读审计结论与待批准方案；没有实现 API、修改数据库或接入真实数据。

## 结论与证据边界

**有条件可行，不能直接安装后就把 Fox Finance 接上。** ZCashflow 具备账户、分类、预算、交易 CRUD、UUID、墓碑和局域网复制基础；缺少经过认证的外部业务 API、幂等和版本条件写入。特殊交易与历史余额语义仍是切换阻断项。

本机检查范围：D 盘根目录、下载/桌面/Programfile/BoheApps/CodexTemp 的直接子目录；HKCU/HKLM（含 WOW6432Node）卸载项；LocalAppData/Roaming 顶层名称与 dev.zcashflow.app、LocalAppData/Programs 的定向检查。未定位到现有 ZCashflow 安装、数据库或源码，**不等于证明未安装**。因此无法核对本机 ZCashflow 当前运行版本、Android APK 版本与 GitHub 的一致性。没有打开或创建真实 ZCashflow 数据库。

已通过 GitHub 连接器读取固定提交 [f72815344a447d9c5a35265f56a2987ab860999f](https://github.com/TheHolyOneZ/ZCashflow/tree/f72815344a447d9c5a35265f56a2987ab860999f)。选定 26 个源码/配置文件只读参考副本位于 D:/CodexTemp/fox-finance-audit-20261103/ZCashflow；这不是完整克隆，不能以它执行构建。package.json 与 src-tauri/tauri.conf.json 为 1.8.0。src-tauri/src/db/mod.rs:12-26 的 SCHEMA_VERSION=6 是同步兼容标记，迁移列表实际含 001–009，不应混同。

下文 Z: 路径均对应此固定提交及上述本地副本。Fox: 指实际安装仓库 D:/Obsidian/OB/.obsidian/plugins/fox-finance。

## 实际能力

| 能力 | 代码证据 | 集成判断 |
|---|---|---|
| 交易业务 CRUD | Z:src-tauri/src/commands/mod.rs:124-135；domain/transactions.rs:439-569 | 可复用 Rust domain；不是 REST |
| 稳定主键和删除 | Z:migrations/001_init.sql:119-145；db/mod.rs:385；transactions.rs:547-569 | UUID 为身份，ref 仅显示；删除为 deleted=1 |
| 账户/分类/预算 | Z:domain/accounts.rs；categories.rs；budgets.rs | 能力存在，必须经 domain 验证，禁止直接 SQL |
| Android/LAN | Z:sync/mod.rs:216-250,717-771 | TCP+Noise 配对复制，不是给 Fox 的 CRUD API |
| 同步冲突 | Z:sync/rows.rs:122-173 | 整行 updated_hlc 较新者胜出，无用户冲突日志 |
| 加密存储 | Z:db/mod.rs:88-98,143-161；vault.rs | 可选；加密状态是内存 DB+加密快照，非 SQLCipher |
| 本地自然语言 | Z:domain/quick.rs:13-108 | 德/英日期和简单金额 token；不是中文语义识别 |
| 余额校准 | Z:domain/accounts.rs:136-149 | 单账户当前 anchor，不是历史调整事件链 |
| 汇率 | Z:domain/currency.rs:43-68 | relabel 仅改标签；不能当换汇 |

## 替代技术路线比较

| 路线 | 代价 | 风险 | 结论 |
|---|---|---|---|
| ZCashflow 进程内 loopback 业务 API，复用 SharedDb/domain | 中高；需维护小型 fork，Rust 服务生命周期/安全/打包 | 上游升级冲突、Android并发语义需验证 | **推荐** |
| Windows named pipe + 当前用户 ACL，进程内业务适配 | 中；OS级访问控制好，无网页跨站面 | Windows专属，Node客户端/帧协议/跨平台维护 | 若确定永远Windows，可作首轮技术探针比较 |
| 独立 sidecar 直接打开同一 SQLite | 表面低，长期高 | 加密模式拿不到运行中的内存状态，绕过领域规则/事件/时钟 | 排除 |
| 把 Fox 做成原生 sync full peer | 高 | 需实现 Noise、行复制、时钟、附件及全部领域约束；扩大数据副本和攻击面 | 排除 |
| CSV/JSON 导出后只读展示 | 低 | 不能满足 Fox 完整 CRUD；不实时 | 可作迁移校验，不作目标架构 |
| GUI 自动操作 ZCashflow | 初期低，维护高 | 焦点/本地化/窗口状态导致误记账，无幂等保证 | 排除 |

loopback HTTP 与 named pipe 的选择应由 Phase 1 的小型、虚构数据探针决定；本阶段没有开发探针。默认推荐 loopback 是为了 Obsidian Electron 与跨平台可维护性，不是宣称它天然安全。

## 推荐数据流

Android ZCashflow 离线副本 ⇄ 原生配对加密 LAN 同步 ⇄ 桌面 ZCashflow SharedDb/domain ⇄ **新增的本机业务 API** ⇄ Fox Finance 数据适配层 → 视图/分析。
Fox 从已提交的一致快照生成 Markdown 镜像 → Obsidian 工作台。镜像修改 → 差异队列 → 用户审核 → API 条件写入。

“唯一权威源”是 ZCashflow 财务领域，而不是只允许一块物理数据库：Android 离线时必然有原生受控副本；Fox 缓存和 Markdown 均不获得自动回写权。桌面暂不可达时显示旧数据和最近确认时间，仅允许保存本地草稿，不以已记账成功提示。避免再引入 Fox 独立离线双向账本。

## 生命周期、刷新与一致性

1. 桌面 ZCashflow 启动且用户解锁后启用 API；仍由 ZCashflow 独占打开/持有 Db。启动 API 不自动解锁数据库。
2. API 绑定显式 127.0.0.1，不以 0.0.0.0、局域网 IP 或 localhost 的泛解析替代。Android 仍通过原生 LAN 监听端口，两个监听面隔离。
3. Fox 启动获取 capabilities、instance/ledger epoch、schema/app/bridge 版本、权限、锁定状态。版本不兼容仅进入诊断，不尝试猜字段。
4. 原生 UI CRUD、定时交易、LAN merge 和 API 写入均需触发同一个已提交变更通知。现有 Tauri ledger-changed 只在进程内；Fox 不能直接订阅另一个应用的 Tauri 事件。
5. 最小方案：Fox 活动时每5秒查询修订摘要，聚焦/手动刷新立即拉取；失联指数退避，失焦降低频率。5秒为建议目标待实测。变更拉取要携带 tombstone；阶段初期全量快照更容易验证，SSE以后按需要增加。
6. 初次与游标失效时获取一致快照及末端游标；分页期间固定快照或拒绝混版本。快照拉完再应用后续变化；不允许翻页后漏删。
7. 刷新顺序：提交/持久化确认 → Fox cache原子替换 → UI成功反馈 → 镜像任务。镜像失败只标注滞后，不能回滚已成功财务写入，也不能重发交易。
8. 加密模式现有 save_vault 每秒异步快照（Z:lib.rs:42-48）。API的“成功”若承诺断电持久化，必须在应答前验证 durable flush 成功；磁盘失败保持待确认状态，以幂等键查询结果，不盲目重试。

## 关键改造边界

Z:src-tauri/src/lib.rs 增加服务启停；commands/mod.rs 与 domain 写入归并提交通知；新增 local_api 模块与鉴权/DTO/能力协商；domain transactions 增加原子 compare-and-write 和恢复删除能力；db/migrations 如需 durable 幂等记录，单独批准后再实施。不能在持有 Db::conn 锁时调用现有会再次获取锁的 domain::create（Z:db/mod.rs:276-283 明确非重入），应最小提取接受事务连接的内层函数，不新建第二数据层。

Fox:finance.ts 拆分领域接口与 Markdown adapter，新增 ZCashflow adapter、mirror writer、差异队列；main.ts 负责连接状态/刷新；各 modal 由行索引改稳定 ID。旧账本适配保留为迁移工具和回滚读取，不能与新源同时写。

## 切换闸门

- 真实本机/Android安装版本与可恢复备份须先定位。
- refund、investment_return、balance_adjust 不允许按表面同名字段静默映射；历史损益、现金流、资产轨迹三者必须同时对账。
- 跨币转账当前 validate 未检验两账户币种一致（Z:transactions.rs:373-390）；API先拒绝而非按同额借贷冒充换汇。
- 预算新增币种由 main_currency 决定（Z:budgets.rs:152-176），不接受“已支持任意预算币种”声明。
- 离线并发 LWW 仍会覆盖旧行。Fox OCC只能阻断自己的过期编辑；当前推荐验收 A07 要求新增同步前历史/冲突队列才能满足。若用户未来明确选择接受 LWW，须先修订验收并记录风险；本轮不降低标准，不能以REST ETag声称解决原生并发。
- GPL-3.0-or-later fork 分发义务与插件边界需在发布前核实；本文件不是法律结论。
