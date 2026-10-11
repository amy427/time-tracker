# Android IndexedDB 只读事务隔离修复

## 根因与范围

手机计时器继续更新、current 和 queueCount 同时停住，最符合“enqueue 已排队，但先前 events 只读事务仍未结束”的表现。旧 paintRecords、renderStats、loadRecords 使用 snapshot 的 meta/ops/events readonly + events.getAll；后来 enqueue 的 readwrite scope 与其重叠，必须等待。桌面存储快时不明显。此为代码与现象支持的最可能原因，7 秒具体耗时仍需真机日志确认。

本轮只修改前端数据库访问、渲染、测试和说明。Apps Script、Drive/Sheets、OAuth、sync_batch、UUID、revision、pending recovery 未改变；不清除本机数据，不重新 setup。

## 修改

- getEventsByIds(ids)：去重后超过 100 个 ID 拒绝，events-only readonly，逐个定点 get；等待事务 complete 后返回。
- paintRecords：读取当前页 metadata 的 IDs 和轻量 meta/ops；recordsView 从当前页对象与 pending effects 投影，不再 materialize 全年事件。
- loadRecords：队列判断改用 getSyncState/getQueueCount，不再 snapshot。
- enqueue 返回不可枚举的 effects（不会写入 state 或上传）。删除只 remove 对应卡片；修改只 replaceWith；拆分替换/插入受影响卡片。保留其他节点。用 revision/页归属维护短期 optimistic 覆盖，避免刚确认的拆分在旧页 metadata 下消失。
- 历史 reconcile 为 500ms debounce，保留 generation 防护；关闭面板不读取或重绘。
- getStatsState：只读 meta/ops。有 query cache 时统计使用 cache + pending effects + current，events 读取和事务均为零。
- 每次操作后 350ms 的本地统计不会访问 events；无 cache 时只显示当前可知的 pending effects/current，并标注不完整。
- 无 cache 的冷启动本机统计恢复为显式分块路径：每个 events-only readonly 事务最多 25 条 cursor 结果，块间让出事件循环。输入使 generation 变化时取消恢复，不把它作为每次操作的 fallback。
- 云端记录页写回 rememberPage 也移除 events.getAll/cache 全量读取，单页最多 100 条写入。过期 preimage 清理为单独最多 25 个 ID 的短事务，重新检查 pending、年份、revision，避免误删跨年迁移后的记录。
- 手动完整导出和冲突/恢复管理仍可使用完整数据；不属于快捷输入后的自动路径。

## 实测请求数

以下是 Node fake-indexeddb 的 API 读取数，不是物理磁盘 I/O；不代表 OPPO 的毫秒耗时。

| 操作 | 100 条历史 | 10,000 条历史 |
|---|---:|---:|
| 当前记录页 events.get | 100 | 100 |
| switch 关键路径 | 1 事务 / 6 读取 | 1 事务 / 6 读取 |
| delete 关键路径 | 1 事务 / 6 读取 | 1 事务 / 6 读取 |
| edit 关键路径 | 1 事务 / 6 读取 | 1 事务 / 6 读取 |
| 有缓存统计 events 读取 / 事务 | 0 / 0 | 0 / 0 |

这些计数不包含之后合并安排的页 reconcile（仍最多 100 个当前页 ID），也不包含云端换版后分块清理过期缓存的维护工作。

## 新增测试

J：读 100 条、删除、延迟统计、同步均不触发 events.getAll。
K：模拟慢移动存储，任何热路径 events.getAll 都立即失败，不实等 5 秒；连续 math/english/fitness 在 3 秒测试超时内完成，bulk 调用为零。
L：100 / 10,000 条对照，页读取有界，删除/修改/切换请求数完全相同，未重建无关卡片。
M：10,000 条历史下 cached stats 不创建 events 事务，并验证 pending effects + current 的秒数。
此外覆盖连续 10 次删除只 reconcile 一次、拆分确认后不消失、调试日志开关、冷恢复分块、跨年缓存清理保护。

## 真机日志

在部署后的前端网址末尾加 ?debug=1（已有查询参数则加 &debug=1）。用 Android Chrome 远程调试打开该页 Console，启用 Verbose/Debug 级别并过滤 [TimeDB]。普通 URL 不输出日志。

日志包括：

- pointerdown：快捷按钮接收触摸；tap：act 被调用。
- enqueue called：操作进入本地入队方法。
- transaction created：id、scope、mode，快捷入队标注 label=enqueue。
- first request success：同一事务首次成功回调与 waitMs。
- transaction complete/abort/error：同一 id 的 durationMs。
- paintCurrent finished：本地 UI 更新完成、revision。
- events.getAll：如果触发完整读取，记录对应事务 id。

解读：tap→enqueue called 长，检查输入串行链；created→first request success 长，重点检查前面尚未 complete 且 scope 重叠的事务；first success→complete 长，检查存储写入；complete→paint 长，检查渲染。IndexedDB 没有公开“真正开始执行”事件，first request success 是可观察的近似点，不是精确的锁等待时间。

不记录 token、操作内容或事件备注，不持久化日志。调试本身存在少量开销；排查完移除 debug 参数。

## 验收

node scripts/build.cjs 成功；node --test tests/*.test.cjs 共 77 项通过、0 失败；git diff --check 通过。未发布，尚未进行本轮 OPPO 真机复测。

发布前端后关闭并重新打开 PWA，确认新 service worker 生效。保留现有大量历史和 pending，复现“408 → 英语 → CS50P → 碎片时间 → 娱乐”。记录 enqueue 的等待分段；不要清理站点数据。当前页最多 100 条、冷恢复最多 25 条的事务仍会短暂共享 store，本次消除的是自动全量历史读取带来的、随历史总量增长的等待，不承诺任何设备永远零等待。
