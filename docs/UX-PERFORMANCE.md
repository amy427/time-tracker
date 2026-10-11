# 登录、批量同步与原始记录优化

日期：2026-10-11。修改的是本地 `amy427/time-tracker` checkout；本次没有发布生产版本、访问 Google Drive 数据或重建云端目录。

## 修改文件

| 文件 | 修改 |
| --- | --- |
| `frontend/app.js` | 批量队列、自动登录触发、local-first 列表、上一页、乐观修改、后台统计 |
| `frontend/ux.js`（新增） | Toast、GIS 控制器、批次大小/回执校验、缓存列表投影 |
| `frontend/db.js` | 原子批量确认、统计缓存投影、年度分页 metadata、保护 pending effects、缓存失效 |
| `frontend/index.html`、`frontend/style.css` | Toast 保留区域、分页按钮；保留 `#status` |
| `frontend/sw.js`、`scripts/build.cjs` | 缓存并参与内容版本计算的新 UX 模块 |
| `backend/Auth.gs` | 单次执行缓存重置，新增 `sync_batch` 分发；验签代码未修改 |
| `backend/Repository.gs` | 顺序 batch、年度排序索引、兼容重建函数、执行内 workbook/sheet cache |
| `tests/fake-gas.cjs` | 模拟排序/删行/清索引；记录 Sheet 读取量、打开次数和锁次数 |
| `tests/performance.test.cjs`、`tests/ux.test.cjs`（新增） | 后端批次/索引/恢复；实际前端函数与 IndexedDB 模拟事务测试 |
| `package.json`、`pnpm-lock.yaml`、`.github/workflows/pages.yml` | 固定 fake-indexeddb 测试依赖；CI 安装依赖，前端没有新增运行时依赖 |
| `README.md`、`docs/DEPLOYMENT.md`、`docs/OPERATIONS.md`、`docs/TESTING.md`、本文 | 使用、升级、维护和验收说明 |

`frontend/transport.js` 原有闭包内 ID token 和每次请求的 iframe/form 桥接保持不变。批处理从调用方减少请求数。没有把 ID token、access token 或 secret 存入 IndexedDB、localStorage、Service Worker 或导出副本。

## 登录与 Toast

GIS 初始化启用 `auto_select: true`、`use_fedcm_for_button: true`、`button_auto_select: true`，启动时调用 `prompt()`。同一 Client ID 不重复初始化；令牌过期后尝试重新获取 credential，自动提示最多每分钟一次，避免持续弹窗。手动按钮始终保留在设置中；“立即同步”在未登录时会展开设置。

Google 当前文档将 `use_fedcm_for_prompt` 标为 deprecated/ignored，因此不依赖该开关。自动成功与否由 Google 会话、浏览器支持、用户选择、冷却期决定，不承诺每次无交互。参考：[Google GIS JavaScript reference](https://developers.google.com/identity/gsi/web/reference/js-reference)。后端 `OWNER_SUB`、audience、issuer、exp、RSA 验签均保留。

Toast 统一支持 loading/success/error，持续时间分别为直到任务结束、1800ms、4000ms。不同任务的 loading 不会被普通成功提示提前清掉；错误优先显示。页面底部预留独立区域，滚动内容在其上方结束，不覆盖快捷按钮。详细原因仍显示在顶部 `#status`。未使用 alert。

## 批处理、一致性与 I/O

每批最多 10 个操作，按本地 seq 顺序提交；大文本请求还按约 85K 字符预算拆批，为 token/请求封装预留空间。`doPost()` 对一个 batch 只验签一次、持锁一次。每条操作继续调用原有 `commit_()`，保留全局 UUID 内容哈希去重、revision 冲突检查及 pending recovery。

回执结构：`{ok, confirmed: [op_id...], state, failed_index, code?, message?}`。`failed_index` 从 0 开始；成功为 null。前端先校验 confirmed 确实是所提交 batch 的前缀，再在一个 IndexedDB 事务中删除确认的操作。失败位置及以后保留；冲突冻结队列。整次网络回复丢失时不删除任何操作，重传由原 UUID 去重。一个失败操作可能已经部分落盘；未列入 confirmed 时继续保留，由下次 pending recovery 完成。

批量确认还会把已确认 effects 合入现有统计缓存，避免队列清空后、延迟云端查询到达前统计回退。修复了跨年编辑在本地构建 effects 时对同一 preimage 重复扣减的问题。旧的云端统计/记录响应不能覆盖更新的确认结果；pending IDs 始终受到保护。

workbook 对象按 ID 缓存在当前 Apps Script execution；年度 book 和 `table_()` sheet 对象也复用。未把 Spreadsheet 对象写入跨请求 CacheService 或 Script Properties。每次 `doPost()` 重新初始化这些缓存。10 操作测试验证同一个已有 workbook 每次 execution 最多 openById 一次。

没有删掉现有 durability flush：pending 指针先落盘 → 原始记录/索引/summary/backup dirty 落盘 → state 落盘 → receipts 落盘 → 清 pending 落盘。state 与 receipt 间的边界保留，避免以未经实网验证的合并换取速度。索引首次创建/重建另有 ready 标记的耐久性边界。

## 年度记录索引与缓存

每个已有年度 workbook 内增加 `records_index` 和 `records_index_meta` 两个辅助 sheet。原 `events`、daily_summary、annual_summary、operation index、event locator、backup 和目录结构保持原含义。

索引保存活跃记录的完整后像及数字 `sort_instant`，按开始时刻降序、UUID 升序排列。这是覆盖式索引：用额外约一份年度活跃记录的空间，换取每页一次连续范围读取，避免 100 次逐 ID 查原表。常规列表每页最多读取索引 100 行，不执行全年 raw rows/map/filter/sort；时间修改/拆分/跨年迁移也能得到正确顺序。旧版可选 date 筛选为兼容路径，可能扫描多个索引页，PWA 年度列表不使用它。

每个 commit 在同一 pending plan 中更新对应索引，删除移除索引项，跨年写入分别更新两个年度索引，再使用 Sheets 原生 sort；恢复重复执行绝对值仍幂等。每次 commit 的原生排序依然有服务端年度规模成本，此次优化没有把写入成本宣称为 O(1)。也没有跳过原始表、summary、备份 dirty、日志或回执更新。

旧年度首次访问或首次写入时，若没有有效索引，读取该年度 events 建立一次。ready 标记最后落盘；中断会重新构建辅助索引。首次建立仍有一次全年读取成本，之后翻页不再重复。

年度 metadata 保存在 IndexedDB `cache` 的 `records:年份`，包含 `year / cloud_revision / fetched_at / complete / next_cursor / pages`；pages 保存各页 IDs 与下一位置。回到已加载页立即本地渲染；30 秒新鲜窗口内且已知云端 revision 没有前进时零请求，否则用一次 records 条件请求检查 revision。同 revision 返回 not_modified，不重传事件。使用全局 revision 是保守策略：其他年份或配置变化也可能使该年度失效。

分页携带 revision；翻页遇到 revision 改变会回到第一页，避免因并发插入/删除引起 offset 跳项。完整刷新才清理已被云端移除的本地缓存记录，且不清 pending 涉及的记录。旧年度缓存不再被原有 90 天事件裁剪静默破坏。采用云端分支、恢复本地副本时会同步失效列表 metadata。

删除/修改/拆分先完成 IndexedDB 原子 enqueue，随即重绘列表和本机统计，再调度后台同步；无网络也可操作。云端成功提示无需等待 query；统计 query 合并后延迟约 2 秒。一次同步只会确认已持久保存的操作。

## 实测与性能对比

本地 Windows / Node v24.19.0。`node scripts/build.cjs` 成功；`node --test tests/*.test.cjs` 共 52 项全部通过，0 失败。原 18 项全部保留。测试使用实际应用函数和 Apps Script 代码，Google Sheets/Drive 是模拟适配器，IndexedDB Node 测试使用 fake-indexeddb。

覆盖 1/3/10 条 batch、中间冲突/错误、丢回复重传、UUID 去重、10 次编辑同批、token 过期/自动提示/手动 fallback、Toast 计时、空/2/100/101/5000 条、分页/缓存/未改 revision、乐观删除失败、编辑/拆分/跨年、重新打开数据库保留 pending、旧响应保护、索引修复真值一致。

还逐一注入了单次提交的 48 个、3 操作批次本次运行的 96 个持久化边界中断，确认恢复后没有重复时长、丢事件或残留 pending。索引维护的各持久化边界也已测试。浏览器 `/qa` 的 9 项真实 IndexedDB 回归全部通过；390×844 和 1280×900 视口检查通过，无浏览器 JS 错误。未改变本机已有的 6 条未同步队列。

下表请求次数针对已登录且没有其他页面并发任务；缓存命中指新鲜窗口内。

| 操作 | 原实现 | 新实现 |
| --- | --- | --- |
| 无 pending 首次读取 100 条 | state + query + records，共 3 次 | records 1 次；先显示已有本机缓存 |
| 再次打开/返回已缓存页 | 通常仍是 3 次 | 0 次；过期检查 1 次，同 revision 不下载事件 |
| 下一未缓存页 | 再次 state/query/records，并重新扫描全年原表 | records 1 次，最多读 100 个索引行 |
| 10 条已排队操作确认 | sync 10 次，随后等待 query | sync_batch 1 次，query 延迟后台执行 |
| 删除卡片消失 | 操作后未立即重绘列表，需重新读取 | 本地事务完成即消失，0 次网络请求；Node 模拟约 1–2ms |
| 单次删除到云端确认 | 1 次 sync；同步状态还等待 1 次 query | 1 次 sync_batch；不等待统计 query |
| 5000 条中的常规 100 条页 | 每次读取/转换/排序全年 5000 行 | 索引建好后最多读取 100 行；同 revision 检查读取 0 个事件行 |

这些是请求计数、读取量及本地模拟时间，不是 Google 真实延迟或 OPPO 真机耗时。batch 内仍逐条执行完整可靠提交；高延迟、配额、索引首次构建可能令请求超时，重试机制会保留和恢复未确认操作。

## 发布顺序与人工验收

1. 先把更新的 `Repository.gs`、`Auth.gs`（以及 build 生成的共享 Core，如有差异）更新到**原 Apps Script 项目**，部署为原部署的新版本，保留 `/exec` URL 和所有脚本属性。旧 `sync` 路由仍兼容旧前端。不要重新创建 Drive 目录，不需要重跑 setup。
2. 再发布 GitHub Pages 前端，关闭并重新打开 PWA，使新 service worker 生效。首次在新 checkout 跑 Node 测试需 `pnpm install --frozen-lockfile --ignore-scripts`；只有测试需要这一依赖。
3. OPPO A1 活力版 5G 上首次手动登录，然后关闭/重开 PWA，保留 Google 会话，验证自动获取 credential 和同步；多账号、退出 Google、浏览器拒绝提示时验证设置内手动按钮。使用浏览器存储检查确认没有 token/secret。
4. 飞行模式产生 3 条记录，关闭/重开确认保留；联网后观察持续 loading、同步完成 Toast、待同步归零。页面统计不应等待云端 query 才结束同步提示。
5. 对可恢复的测试记录执行删除、修改、拆分，确认卡片立即变化、离线重开仍有效；联网确认对应成功 Toast。云端原表删除标记、summary、年度位置应正确。
6. 两台设备从同一 revision 修改，先同步其中一台，另一台应显示冲突并保留未确认队列。同步中断网后重试，确认 UUID 和时长不重复。
7. 读取一个含 101 条以上的测试年度，翻页、回上一页、再打开；开发者工具验证不重复下载第一页，同 revision 仅条件检查。首次旧年度建立索引可能较慢。

若需要提前建立或修复索引，在原 Apps Script 编辑器增加并运行：

```javascript
function repairRecords2026() {
  rebuildRecordsIndex(2026);
}
```

函数只重建辅助索引，先恢复 pending，再使用恢复计划更新 revision 以使客户端缓存失效。不要手工删除原 events 或重建目录。若手工改过原始事件字段，仍须按原运维步骤重算涉及年度 summary，并修复索引；不建议直接改 Raw。实际 Google 登录、Apps Script 回执与 OPPO 真机步骤留作部署后的人工验收。
