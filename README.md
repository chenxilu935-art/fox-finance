# 🦊 狐の财富系统 — Fox Finance

> 一个基于 Obsidian 的个人财富管理系统。  
> 不是传统记账软件——是陪伴你长期成长的财富森林。

## 预览
<img width="2159" height="1314" alt="image" src="https://github.com/user-attachments/assets/181f5bf7-1ad7-45f5-b94e-9274a03ba874" />
<img width="2094" height="1310" alt="image" src="https://github.com/user-attachments/assets/a99a5ca1-856a-441a-a021-5bfbc65a67cb" />
<img width="1049" height="656" alt="image" src="https://github.com/user-attachments/assets/480a33af-c377-4adb-97f4-a756d96ef330" />
<img width="1049" height="653" alt="image" src="https://github.com/user-attachments/assets/cb62220d-b27a-4cca-9960-addc878cfde4" />

---

## 快速安装

### 前置要求
- Obsidian v1.4.0+
- 已安装 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) 插件，或手动安装

### 方法一：BRAT 安装（推荐）
1. 安装并启用 BRAT 插件
2. 命令面板运行 `BRAT: Add a beta plugin for testing`
3. 输入本仓库的 GitHub URL
4. 启用插件「狐の财富系统」

### 方法二：手动安装
1. 从 [Releases](../../releases) 下载最新版 `fox-finance.zip`
2. 解压到 `<你的 vault>/.obsidian/plugins/fox-finance/`
3. 重启 Obsidian，在设置 → 第三方插件中启用「狐の财富系统」

---

## 使用入门

1. 点击左侧 Ribbon 的 🪙 图标，或命令面板运行 `打开财富森林看板`
2. 首次打开会自动创建数据目录 `Finance/Ledger/` 和 `Finance/Inbox/`
3. 点击 **记一笔** 开始记录第一笔交易
4. 在插件设置中配置你的账户、分类和预算

### 设置你的系统

设置 → 第三方插件 → 狐の财富系统：

- **背景主题**：选择 银河森林 / 森林玻璃屋 / 自定义
- **自定义背景**：添加 vault 内图片路径，多张图片自动轮换
- **账户管理**：添加微信、支付宝、银行卡、月月宝等账户
- **分类管理**：自定义收支分类和二级分类
- **预算**：为支出分类设定月度/年度预算

---

## 数据说明

- 所有数据存在你的 vault 里，不依赖任何外部服务
- 账本：`Finance/Ledger/YYYY-MM.md`（一月一个文件）
- 暂存箱：`Finance/Inbox/`（快速捕获，后续导入账本）
- 纯 Markdown + YAML，任何文本编辑器都能打开

## 背景与图标

内置了两套背景主题和一套自定义图标。你也可以在设置中添加自己的背景图片（放在 vault 任意位置），系统会自动随机轮换。

## 开源协议

MIT — 可自由使用、修改、分发。保留原作者署名。
