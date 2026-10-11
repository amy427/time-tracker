# 快捷切换与同步并发修复

修复基线：`f202dd6`。仅修改本地前端、测试与文档，没有更新线上部署或操作 Google Drive。

## 根因

此前 `act()` 的共享 serial 链不只保存操作，还等待完整 repaint 和 paintRecords。读过历史列表后，recordsYear 一直保留，即使面板收起，也会全量读取 events/caches 并重建最多 100 张卡片。下一次点击必须排在这些工作之后。

enqueue 和每次 snapshot 都走包含所有 store 的 readwrite mutate；一个点击重复加载本地历史、操作队列和统计缓存。repaint 没有 generation/version 检查，迟到的读取可能覆盖刚刚切换的 current。若底层已是目标活动，原来的 no-op 又直接返回，无法修正错误的界面。

没有发现“网络 await 被直接放进 IndexedDB 事务”的代码。已确认的问题是本地过重的串行工作及旧 UI 回写风险；不能把 Node 测试时间当成 OPPO 上数秒延迟的硬件测量。

## 实现

- `frontend/db.js`：enqueue 改为一个只涉及 meta、ops、events 的原子事务。读取 local/device/conflict，读取 seq 索引末尾一个 key、队列 count，以及操作涉及的 UUID 定点记录。switch 最多定点查一个 event；stop 不读历史事件。任何 enqueue 都不调用 getAll，不访问 cache。
- `enqueue()` 仍返回已提交的 plan.state，只在事务 complete 后兑现 Promise。附带不可枚举、不会写入数据库的 queueCount 回执，供状态栏使用。重复点击当前活动或重复 stop 在事务内判断，并返回最新 local state，前端仍校正 UI。
- 新增 `getLocalState()`、`getCurrent()`、`getQueueCount()`、`getOverview()`、`getSyncState()`。同步和当前活动刷新不加载历史或缓存。完整 snapshot 变为 readonly，也不读取缓存；初始化 local/device 移到 open 时一次完成。
- `frontend/app.js`：serial 只包含 enqueue 和同步执行的 paintCurrent、轻量通知/调度。switch/stop 不调用 repaint、paintRecords 或 renderStats，不重建快捷按钮；只修改 current 文案、计时、stop 状态和已有按钮 active class。统计合并到 350ms 后的本地刷新；云端统计仍约 2 秒后台刷新。
- 历史 delete/edit/split/import 的列表重绘在 serial 链外执行，只在面板打开且涉及所选年份时调用；config 不重绘历史。paintRecords 在读取前后都检查面板状态。不同记录刷新使用独立 generation，避免历史操作与快捷输入互相阻塞。
- 当前 UI 使用输入 generation、读取 request generation 和 revision 检查。旧异步读取不能覆盖新提交；明确“采用云端/恢复本地副本”时允许合法的 revision 回退。
- `acceptBatch()` 在确认事务中检查当时真正存在的 ops，只删除指定回执 IDs。只要还有未确认操作，就只更新 cloud，不覆盖 local。额外阻止旧重复回执降低已确认的 local/cloud revision；确认操作不再全量读取 events。
- `frontend/style.css`：Toast 本体显式设置 pointer-events:none，保留容器原有设置。busy/loading 不参与快捷按钮 disabled 判定；只有实际 revision conflict 才冻结输入。
- `frontend/sw.js`：build 生成新的内容版本，确保 PWA 能更新缓存。

后端 sync_batch、UUID 去重、revision、pending recovery、年度索引和 Google OAuth 均未修改。没有新增云端表、修改原始数据结构或运行 setup。

## IndexedDB 操作计数

对基线 `f202dd6` 与工作区版本使用同一套 fake-indexeddb 请求计数器，场景为：已读取 100 条历史记录、收起面板、已有 408 当前活动，再点击数学二。计数是 API 请求数，不是底层磁盘 I/O 次数。

| 阶段 | 事务数 | 读取请求 | put 请求 | events 全量读取 | cache 全量读取 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原版 act 返回时（含已经启动的统计读取） | 6 | 34 | 10 | 4 | 4 |
| 原版该点击及紧接着的即时统计全部完成 | 7 | 42 | 12 | 5 | 5 |
| 新版 switch 关键路径 | 1 | 6 | 4 | 0 | 0 |
| 新版 stop 关键路径 | 1 | 5 | 4 | 0 | 0 |

原版实际 await 的串行依赖为 5 个事务；另一个统计读取虽不 await，但在 act 内立即启动。新版统计在点击完成后延迟执行，不计入关键路径，也不在输入 serial 链中。

switch 的 6 次读取：meta/local、meta/device、meta/conflict、seq 末尾 key、ops.count、目标 UUID 的 events.get。4 次写入：结束的事件、队列操作、新 local、device。首次启动尚无旧活动时少一个事件写入。重复点击 no-op 不新增任何写入。计数已作为自动回归断言。

## 新增测试及结果

`tests/ux.test.cjs` 新增 10 项，共 62 项 Node 测试全部通过，0 失败；`node scripts/build.cjs` 成功。真实 Chromium `/qa` 的 9 项 IndexedDB 回归也再次通过。实际页面初始化正常，12 个快捷按钮均可用，Toast 计算样式为 pointer-events:none，没有浏览器 JS 错误。

1. **A：network in-flight switch**。先排队 2 条、当前 408；让真实 sync() 使用的 mock batch Promise 不 resolve；连续切 math/english/fitness，在释放网络之前验证 local、UI 健身、active、按钮未禁用及 3 条新操作。随后回复第一批，下一批确实只发送新增 3 条，全部确认后没有回退。
2. **B：收起已加载历史**。缓存并显示 100 张卡片，保留 recordsYear 后关闭面板。mock 网络挂起并将测试时钟前进 30 秒；点击 math，paintRecords 调用数为 0，原卡片节点不变，records 请求数为 0，无 getAll/cache 读取。
3. **C：stale repaint**。旧读取先取得 408，阻止其交付；随后提交 math，最后放行旧重绘，UI 和 local 仍为 math。还人为弄错显示后重复点 math，验证不增加队列但修复 UI。
4. **D：enqueue during acknowledgement**。batch 发出后新增 math；第一批 acceptBatch 完成瞬间检查：旧批次已删除，新增 UUID 仍在队列，cloud 为 408、local 为 math；后续正常发送新批次。
5. switch/stop 精确事务和读写计数，验证无云端请求、无按钮重建。
6. 人为挂起历史重绘的 Promise，仍能继续切换；关闭历史面板时 import/config 不调用记录重绘。
7. 旧重复确认不能回退已经确认的新 current。
8. 网络挂起期间 stop 立即持久保存并清空当前 UI。
9. 同时调用 enqueue 和 acceptBatch，分别测试两种事务先后顺序，都保留新增操作与正确 base_revision。
10. 无效时间导致快路径事务失败时，数据库和 UI 都保持原活动。

Node 一次测量：switch 约 1.22ms、stop 约 0.77ms，从调用到完成本地提交和模拟 DOM 更新；实际数值随机器负载变化，不等同手机触摸到屏幕呈现时间。回归主要断言无网络依赖、固定事务数和状态正确性，不以偶然的墙钟耗时作为正确性标准。

## 为什么 30–45 秒网络等待不会占住本地输入

sync() 在事务外等待 transport Promise，没有持有任何本地 IndexedDB 事务或 act 的 serial 链。快捷点击只有本地 enqueue → paintCurrent；之后的同步调度即使遇到已在运行的 sync，也不会被 act 等待。网络返回后确认与 enqueue 由 IndexedDB 短事务串行化；新 op 保留 local 的优先权，旧 UI 读取则被 generation 丢弃。

IndexedDB 自身短事务、浏览器主线程调度及设备性能仍决定真实触摸延迟，不能承诺所有负载下绝对小于 100ms；此次已移除随历史数据量增长的快捷点击工作和网络依赖。

## OPPO 验收

这次只需发布前端并关闭、重开 PWA 使新的 Service Worker 生效，不需重新部署后端或 setup，也不要清浏览器数据。

1. 先读取 100 条历史，再收起面板。
2. 当前 408、存在 2～3 条 pending，开始同步。在 loading Toast 存在期间连续切数学二 → 英语 → 健身，再点结束。
3. 每一步立即检查活动标题、active、计时器和停止按钮，目标是触摸至视觉变化 <100ms。记录真机屏幕或浏览器 Performance 可测实际延迟。
4. 同步回复后当前活动不可倒退；断网重开时新操作应仍在本地队列，恢复网络后最终按顺序清零。

本次未操作 OPPO 真机；<100ms 的真机目标需要更新后的这一轮验收确认。
