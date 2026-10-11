# 时间 · 事件记录系统

为 Android 一键记录设计的 PWA，Google Apps Script 写入个人 Google Sheets，Drive 按年度归档并定时备份。纯原生 JavaScript，无数据库服务器，无运行时 npm 依赖。默认 Asia/Shanghai。

## 当前交付状态

本地可运行项目已实现：一键开始/切换/结束、恢复当前活动、IndexedDB 原子队列、重试与 UUID 去重、Google 身份验证、版本冲突保护、今日/周/月/历史统计、配置管理、历史编辑/拆分/删除、年度分片、每日/年度汇总、CSV/JSONL/manifest 备份、校验导入和本地副本恢复。

尚未在你的 Google 账号创建云端资源或部署公网地址。Google 登录、Apps Script iframe 回执、真实 Sheets/Drive 读写、定时触发器及 OPPO A1 活力版 5G 上的安装与锁屏需按部署教程做集成验收。自动化模拟通过不能代替这些验收，也不能承诺免费平台 100 年不变。

## 快速打开

在本目录打开 PowerShell（电脑需有 Node.js 20 或以上）：

也可直接双击 `启动本地预览.cmd`，并保持预览窗口开启。预览数据与手机正式部署数据相互独立。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
node scripts/build.cjs
node --test tests/*.test.cjs
node scripts/serve.cjs
```

首次运行测试需要安装开发依赖 fake-indexeddb（使用 pnpm；标准 Node/npm 环境也可用 `npm install --ignore-scripts`）。运行 PWA 和构建不需要该依赖。

电脑浏览器打开 http://127.0.0.1:4173/ 。初次未连接云端时，可验证本地记录，页面清晰提示待同步数量。localhost 数据只存在这台电脑，手机安装必须使用 HTTPS 公网网址，不能把 localhost 当作部署结果。

浏览器可靠性测试：http://127.0.0.1:4173/qa 。它使用独立临时 IndexedDB，模拟回执丢失、恢复网络、冲突与原子保存。不要从电脑本地预览积累正式记录；不同来源的 IndexedDB 相互独立。

## 文件导航

- [架构与长期扩展自检](docs/ARCHITECTURE.md)：数据流、Schema、安全、跨年归档、风险。
- [逐步部署和 OPPO 安装](docs/DEPLOYMENT.md)：点击位置、复制内容、账号配置。
- [备份、恢复、迁移和故障处理](docs/OPERATIONS.md)：恢复完整数据与离线队列。
- [测试报告与最终验收](docs/TESTING.md)：已验证和需实网验证的项目。
- [2026-10-11 UX 与性能优化](docs/UX-PERFORMANCE.md)：批量同步、年度索引、缓存、性能对比、升级与手机验收。
- `frontend/`：完整静态 PWA；仅此目录发布到 GitHub Pages。
- `backend/`：Apps Script 源码和清单；`Core.gs` 由构建复制生成。
- `tests/`：核心、服务端恢复与浏览器事务测试。
- `.github/workflows/pages.yml`：免费静态发布工作流。

## 使用规则

1. 点活动按钮即本地保存，切换会自动结束上一项。重复点当前活动不创建无意义记录。
2. 本地保存成功后才更新界面。未同步操作不因超时删除；重新打开后恢复。
3. 首页总时长包含尚未结束的活动估计；Raw 只保存已完成记录。底层秒数始终为整数。
4. 打开设置并 Google 登录后自动同步。token 只在内存，关页或过期需再登录；离线仍能一键记录。
5. 周从周一开始，月份可选历史月份；历史可按日期/周/月/年/全部和科目查询。
6. 原始记录列表按开始年份加载。跨年原始记录完整归档于开始年份，统计按各自自然日拆分。
7. 修改请使用 App；改表后必须运行重建函数，见维护文档。
8. 多设备版本冲突会暂停同步。先导出本地副本，再采用云端状态；原分支会留在冲突副本中。

## 百年架构的实际边界

每年独立 Raw/daily_summary 文件；Master 只保存约每年一行索引与累计、固定配置状态。UUID 去重与事件定位使用 256 个按 UUID 前缀划分的紧凑索引文件，按需创建，避免扫描百年原始数据。每天 100 次切换约 36,500 条/年，100 年约 365 万条。默认每年安全上限 10 万条，达到时暂停写入并保留队列，需要先迁移分片。公开 Google 平台有容量、执行时长和每日配额；需长期保留第二份异地备份。

资料核查基于 [Apps Script 配额文档](https://developers.google.com/apps-script/guides/services/quotas) 和 [Google Sheets 大数据最佳实践](https://developers.google.com/apps-script/guides/support/best-practices)。容量估算是架构规划，不是永久存储担保。

## 数据迁移

标准 JSONL 是无损恢复主格式，CSV 是通用分析格式（防公式注入的单元格可能有前置单引号）。manifest 保存 SHA-256、字节数、记录数、生成时间和 schema_version。不同版本备份不盲目覆盖；每次生成新版本文件。无合并单元格，无平台专有的数据编码。

连接 Google Drive 后，可给 ChatGPT 指定 TimeLog_年份 的 events、daily_summary 或 Master 的 annual_summary；跨年分析同时读相关年度。连接器的权限与可读取能力以你的账号为准，本项目不自动向 ChatGPT 发送数据。

安全：前端 Client ID 和 /exec 网址可以公开；不要公开 token、任何 client secret 或脚本账号授权。后端校验 Google RSA 签名与固定 OWNER_SUB，所有写入受 ScriptLock 和 revision 保护。
