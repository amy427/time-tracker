# 批次确认与派生缓存隔离（2026-10-11）

## 根因

上一轮仅跳过 acceptBatch 的 events.getAll，通用 mutate 仍创建 meta/ops/events/conflicts/cache 五个 store 的 readwrite 事务，读取全部队列和全部缓存，再逐个更新 query 汇总。与 enqueue 的 meta/ops/events 重叠，因此回执落地时仍会阻塞快捷输入。

## 修复

- acceptBatchCore 只使用 meta/ops，一个原子事务：3 个 meta.get、按确认 UUID 定点 ops.get（最多 10 个）、ops.count、删除实际存在的确认项、单调更新 cloud。在没有冲突且没有未确认操作、服务端 revision 不旧于 local 时才更新 local。
- 原有 TimeUX.acceptResponse 的 confirmed prefix 校验保留；网络期间新增 UUID 不在确认集合中，不会删除或覆盖。
- 核心事务完成后返回最小 effects/revision 信息。acceptBatch 通过定时任务安排缓存更新，不等待缓存 Promise。
- reconcileConfirmedCaches 使用独立 cache-only readwrite 事务和 query: 范围 cursor，不遍历 records cache，不锁 meta/ops/events。每个 cursor 回调之间让出事件循环。
- 缓存写失败不影响 durable ack。汇总 revision 有缺口时不盲目叠加后续 effects；统计页面拒绝落后于 cloud 的缓存，暂用本机记录并明确标记可能不完整。延迟云端 query 修复汇总，刷新后同样有效。
- mutate 根据 events/caches/conflicts 的实际需求构造 scope；remote/freeze 不再锁 events/cache/conflicts。仅冲突分支保存和恢复显式申请 conflicts。
- Toast 文案改为“正在同步…”。

## 确认关键路径计数

n 为本次确认的不同 UUID 数量（0～10），以下是 IndexedDB API 请求次数，不是磁盘 I/O 次数。

| 项目 | 之前 | 之后 |
|---|---|---|
| readwrite scope | meta/ops/events/conflicts/cache | meta/ops |
| getAll | 2（ops、cache） | 0 |
| getAllKeys | 1（cache） | 0 |
| cache 读取 | 2 次全量读取 | 0 |
| events 读取 | 0，但仍锁 events | 0，且不锁 events |
| ops 读取 | 1 次 getAll，读取整个队列 | n 次 get + 1 次 count |
| meta 读取 | 4 | 3 |
| 核心事务 | 1 个重事务 | 1 个有界事务 |
| 派生缓存事务 | 核心事务内 | 另一个不被确认/切换等待的 cache-only 事务 |

快捷 switch 保持 1 个事务、6 次必要读取。测试 G 的两条确认与一次切换同时提交：空缓存和 1000 个普通缓存 + 100 份记录页元数据 + 10 个 query summaries 均为 2 个事务、12 次读取。

## 回归测试

- E：100 条 records、多个 query cache、5 个 pending ops；同步完成后实际保持 cache-only 写事务活跃，连续 math/english/fitness 均在释放事务之前落盘并更新 UI。
- F：确认 scope 只有 meta/ops，零 cache/events/bulk reads，定点 UUID 数量有界。
- G：大量缓存下，确认与切换的请求数不增长。
- H：故意 abort 缓存写事务；确认 UUID 保持删除，cloud revision 正确，较新的 local/队列保留，仍可继续记录并重新 query。
- I：加载历史、连续删除、收到回执后，在 cache 写事务保持活跃时完成英语/CS50P/碎片时间/娱乐切换。
- 额外：跳过一次缓存更新并刷新数据库连接，不会把缺少 effects 的汇总标记为最新，重新查询能够修复。

挂起测试用可控 gate 保持真实 IndexedDB cache 写事务，不是仅挂起一个不持锁的 Promise。所有断言在释放 gate 前完成；无需实等 30 秒，测试超时 3 秒可以发现串行阻塞。

## 验证与部署

node scripts/build.cjs 成功；node --test tests/*.test.cjs：68 项全部通过（原有 62 + 新增 6）。

只修改前端、测试及说明，未改后端、OAuth、Drive/Sheets 结构或云端记录。尚未发布。

发布前端后关闭并重新打开 PWA，保留现有浏览器数据，复测“读历史/删除 → 同步回执到来 → 连续切换”。本次消除了回执缓存处理与 enqueue 的 store-lock 耦合；模拟测试不能承诺特定手机的绝对毫秒延迟，仍需 OPPO 验收。
