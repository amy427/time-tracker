# 同步调度与持久化回执优化

## 本轮范围

修改后端 Auth.gs、Repository.gs、Backup.gs。保留现有 profiler、前端 45 秒 timeout、batch 上限 10、OAuth、revision、UUID 校验、pending recovery 和全部持久化 flush。没有修改 Drive/Sheets 数据结构，也没有执行 setup 或部署。

## 设计与恢复安全性

- doPost 将锁内批次 deadline 改为取得锁后 10 秒；commitBatch_ 自身也限制为 10 秒软预算。只在完整 commit 之间检查，超出预算返回 YIELD 和已确认前缀。客户端未确认后缀继续保留原 UUID。
- 软预算不是硬超时：在 10 秒前启动的一个 21 秒 commit 仍可完整运行，约 31 秒结束锁内业务。异常漫长的单次 commit 或 recovery 仍可能超过 45 秒；不能在持久化序列中途强制取消。
- CacheService 回执包含 op_id、request_hash、revision，键包含 MASTER_ID。新提交仅在 receipt flush 成功后写缓存；从 durable OperationIndex 读到的回执也可回填。命中仍经过规范化 payload 的 hash 比较，同 UUID 不同内容拒绝。
- 缓存读取失败、丢失或内容无效时回到 durable OperationIndex；缓存写失败不影响提交。缓存不是幂等真值。Google 官方也明确缓存读取可能返回 null：[Cache 文档](https://developers.google.com/apps-script/reference/cache/cache)。旧回执首次读取仍需要 durable lookup，之后才能获得热缓存收益。
- planning/capacity 已知的事件、定位索引、daily/annual summary 行号以及已确认不存在的行，在同一 commit 内复用。record index 和 backup dirty 使用已找到的行，不再次 TextFinder。新 receipt 在锁内已证明不存在时直接追加。
- 行号提示只在当前 commit 的内存里使用，不写入 pending plan；恢复时重新查询。record index 排序/删除后不跨操作复用行号。

耐久性顺序完全保留：pending durable → business writes durable → state durable → receipt durable → pending clear durable。

在 receipt flush 前失败不会生成新回执缓存；在 receipt flush 后、清 pending 前失败，下一次请求仍先 recover，再做去重。恢复路径不用“新 receipt”提示，按 durable 数据 upsert，不会因重试追加重复回执。

## 同一模拟负载比较

完整输出见 [SYNC-BENCHMARK.json](SYNC-BENCHMARK.json)。基线为 Git 提交 `2bc2ad8dc786530befa235e072e21784dbd08dd7` 的业务实现；基线尚未包含 profiler，因此两边均由外部计时包装采集指标，不修改 profiler。

负载为 10 个固定 UUID 操作，前 5 个已持久化但模拟响应丢失。两边使用相同初始业务数据、服务调用延迟和存储停顿。新版本缓存由真实提交完成后生成，未人为填充。

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 最长请求 total_ms | 42,915 | 23,031 |
| 首次请求 lock_ms | 42,760 | 13,816 |
| 首次请求确认操作数 | 7 | 6 |
| 前 5 个 duplicate 平均 lookup_op_ms | 410 | 8 |
| 同一首个真实 commit total_ms | 15,150 | 12,536 |
| 该 commit apply_plan_ms | 10,700 | 8,308 |
| 同一第二个真实 commit total_ms | 24,320 | 22,536 |
| 完成全部操作的请求数 | 3 | 5 |
| 所有服务端请求累计耗时 ms | 89,025 | 76,095 |
| 最终 revision / 总秒数 | 10 / 300 | 10 / 300 |

这些是确定性模拟数据，不是生产实测或延迟承诺。模型固定成本：getValues 90ms、setValues 160ms、setNumberFormat 15ms、getLastRow 30ms、getMaxRows 15ms、TextFinder 180ms、openById 250ms、flush 350ms、Drive createFile 800ms、trash 150ms、cache get/put 各 8ms、认证 120ms、等锁 35ms；真实 commit 额外存储停顿依次为 3s、13s、其后 3s。

请求累计耗时不含前端 YIELD 冷却和网络传输。更多批次可以降低单请求超时风险，但不保证端到端队列清空时间同比缩短。

复现（仓库根目录）：

```powershell
node scripts/benchmark-sync.cjs 2bc2ad8dc786530befa235e072e21784dbd08dd7
```

## 验证

`node scripts/build.cjs` 成功；`node --test tests/*.test.cjs` 共 110 项通过，0 失败，包含原有 96 个 batch 持久化故障边界和 48 个单操作故障边界。

新增验证覆盖：cache hit 时 OperationIndex 打开次数为 0、hash 不匹配拒绝、cache eviction/损坏/服务异常的 durable fallback、receipt flush 前失败不缓存、混合 duplicate/真实提交软预算 YIELD、多次丢响应重传不重复 event/summary、已知行不重复查找，以及客户端只删除 YIELD 已确认前缀且刷新后未确认 UUID 仍保留。

## 部署与生产复核

1. 将本轮 Auth.gs、Repository.gs、Backup.gs 更新到现有 Apps Script 项目，保留已发布的 Perf.gs。
2. 在现有 Web App 部署中选择新版本，保持原 URL、访问权限和业务属性。无需重新 setup，无需更新前端。
3. 用真实待同步队列验证 YIELD 后继续同步、最终队列清空。
4. 手动运行现有 perfDiagnostics()，比较 total_ms、lock_ms、duplicate lookup_op_ms、真实 commit total_ms、apply_plan_ms。冷缓存和热缓存分开比较；profiler 只保留慢请求，所以快 duplicate 请求可能不再出现在诊断记录里。
