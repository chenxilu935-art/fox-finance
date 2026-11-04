# 开源方案筛选（先研究，后开发）

查询日期：2026-11-03。GitHub动态快照，Stars不等于质量。为满足本地、Android、预算、可集成等约束，选取3个候选进行方向比较；不擅自替换用户已定Z数据源。

| 项目 | Stars / 最近push(UTC) | 许可证 / 技术栈 | 部署、可直接用的部分 | 所需二开 / 成本与风险 |
|---|---|---|---|---|
| [ZCashflow](https://github.com/TheHolyOneZ/ZCashflow) | 4 / 2026-11-02 20:49 | GPL-3.0 / TS React + Tauri Rust SQLite | 原生桌面/Android产品方向符合本机与局域网；可独立使用其记账功能，但本轮未验证安装实机 | 无现成Fox REST；需进程内桥接、同步/删除验证、映射；中高集成成本、项目很新和fork维护风险 |
| [Actual Budget](https://github.com/actualbudget/actual) | 29,931 / 2026-11-03 04:14 | MIT / TS、JS、本地数据引擎 | 可使用现成预算界面与同步部署；Android使用方式/离线体验需单独验收 | 官方是Node API包，非现成HTTP端点；仍需桥接和Fox映射；中成本，改变已定数据源与记账模型 |
| [Firefly III](https://github.com/firefly-iii/firefly-iii) | 25,064 / 2026-11-02 03:11 | AGPL-3.0 / PHP Laravel + 数据库 | 可直接部署个人财务Web服务，README列出Docker/自建路径 | 后端运维更重；手机离线/局域网原生同步不能假定已有；中高成本，与纯本机方向偏离 |

推荐：保持ZCashflow方向，但将“桥接+Android同步+恢复”设为阶段关口。三者均不能直接拿来无改造完成 Fox + Obsidian 镜像要求。若Z实机门槛失败，Actual是备选研究对象，而不是本轮更换底座。

来源：[Z元数据](https://api.github.com/repos/TheHolyOneZ/ZCashflow)、[Actual元数据](https://api.github.com/repos/actualbudget/actual)、[Firefly元数据](https://api.github.com/repos/firefly-iii/firefly-iii)、[Actual官方API说明](https://actualbudget.org/docs/api/)、[Firefly README](https://github.com/firefly-iii/firefly-iii/blob/main/readme.md)。Firefly安装文档本轮访问403，部署判断以其README支持的路径为限。Z细节以本地下载的固定提交源码审计为准。
