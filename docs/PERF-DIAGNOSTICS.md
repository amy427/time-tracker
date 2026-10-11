# 临时慢请求 profiler（仅诊断）

本轮修改 Auth.gs、Repository.gs，新增 Perf.gs。未修改前端、45 秒 timeout、batch 上限 10、现有批次预算/重试逻辑、锁等待参数、revision、UUID、pending recovery、flush 次序或云端数据结构。

## 部署与使用

1. 在原 Apps Script 项目中替换 Auth.gs、Repository.gs；新建脚本文件 Perf.gs 并粘贴同名文件内容。三个文件必须一起保存。
2. “部署 → 管理部署 → 编辑现有 Web App → 新版本 → 部署”。保留原部署网址、执行身份和访问权限，不运行 setup，不新建数据。
3. 照常在手机使用。慢请求完成后，在 Apps Script 编辑器函数下拉框选择 perfDiagnostics，点击 Run。
4. 在该次手动执行的 Execution log 查看按 timestamp 排序的 JSON，末尾有 SLOWEST REQUEST、SLOWEST COMMIT、SLOWEST APPLY STAGE。
5. 清理诊断时手动运行 clearPerfDiagnostics。它只删除 PERF_SEQ 和 PERF_SLOT_0～9，不触碰任何业务/OAuth 属性或文件。

## 数据与存储

全部阶段用 Date.now() 在内存计时。doPost 最外层 finally 计算 total_ms，并在确定 ScriptLock 已释放之后保存。快请求不调用诊断保存接口；满足 total_ms >= 8000、lock_ms >= 8000、任一 commit.total_ms >= 8000，或出现异常时才保存。异常只记布尔值，绝不保存异常原文。

固定 10 个 PERF_SLOT 和 1 个 PERF_SEQ，单次 setProperties 同时更新序号与 slot，不写 Sheet/Drive，不新增锁。所有持久化错误被吞掉，不影响业务返回。并发请求可能竞争同一个槽位；这是尽力而为的诊断环形缓冲，宁可丢一条诊断也不重新竞争业务锁。不是审计日志。

只保存白名单 action、timestamp、序号、数值耗时和布尔值；不保存 token、email、UUID、事件名、备注、请求或响应内容。单槽 JSON 限制为 8000 个 ASCII 字符；极端超长时保留耗时最大的 commit 并标注 truncated，正常 10 个详细 commit 可完整保存。

## 字段含义

- 顶层：auth_ms、lock_wait_ms、lock_ms、recover_ms、batch_size、commits；读请求还有 state_ms/query_ms/records_ms。
- 每个 commit：index、total_ms、recover_ms、state_ms、lookup_op_ms、planning_ms、capacity_check_ms、set_pending_ms、apply_plan_ms。
- pending 额外区分：pending_drive_ms（创建恢复文件）、pending_pointer_ms（写指针/摘要）、pending_flush_ms。
- commit.apply：rebuild_index_ms、event_write_ms、event_index_ms、record_index_ms、record_sort_ms、daily_summary_ms、annual_summary_ms、backup_dirty_ms、flush_before_state_ms、set_state_ms、flush_state_ms、receipt_write_ms、flush_receipt_ms、clear_pending_ms。
- 清除 pending 额外区分 clear_pending_flush_ms 和 clear_pending_drive_ms（临时文件移至回收站）。
- 恢复旧 pending 的 apply 阶段聚合在顶层 recovery_apply，不误记为当前 commit 自己的 apply。

层级耗时包含子阶段，不能全部相加。例如 set_pending_ms 包括 pending_drive_ms/flush_ms，clear_pending_ms 包括清空指针/flush/文件清理，record_index_ms 包括懒重建时的 rebuild_index_ms。多个事件写入的同名阶段累计。没有执行的阶段为 0。

lock_ms 在 releaseLock 返回后立即计算；不包含 profiler 的序列化和 ScriptProperties 写入。total_ms 截止构造业务响应完成、诊断持久化之前；不包含平台排队/响应传送和诊断保存耗时。因此它不必与 Executions 的总时长完全相同。脚本被平台强制终止时 finally 可能无法运行，这种执行可能没有 profile。

## 验证

新增测试覆盖：锁外持久化、快请求零保存、8 秒阈值、最多 10 个槽位、隐私白名单、保存失败不影响返回、仅清理诊断属性、逐阶段耗时/最慢总览、恢复阶段、pending Drive/flush 拆分和槽位大小。现有业务测试保持通过。

## 持久化生命周期补强与手动自检

当前本地原代码正常释放锁后已有 `_held=false`，未复现“正常路径一直为 true”。仅凭 Executions 的平台耗时和空 diagnostics 不能确认是这个原因；旧 perfFinish 会静默忽略保存异常，缺少自检状态。

现在 doPost 用局部 held、lock 和 profile._held 同步管理：成功 tryLock 后设 true；releaseLock 成功后先立即清零两者，再计算 lock_ms。内层 finally 负责正常释放，统一 outer finally 防御性清理，并仅在确认两者均为 false 后调用 perfFinish。成功释放后不会再次 release。如果第一次 release 抛错，hasLock 确认已释放则不重复调用；仍持锁时仅重试释放一次。若最终仍无法确认释放，不伪造 false、不写 profiling 属性。

perfFinish 返回只含固定状态的 saved/skipped/failed 结果。Web App 忽略该结果；手动测试会打印并读回验证。因此业务响应不受诊断失败影响，也无需依赖 Web App 日志。

更新步骤：替换本轮 Auth.gs 和 Perf.gs（保留已发布的 Repository.gs 阶段计时），保存后在编辑器运行 testPerfDiagnosticsWrite。正常输出应包含：

    PERF WRITE TEST: {"status":"saved","slot":"PERF_SLOT_0","total_ms":9000,"verified":true}

slot 和 total_ms 可以不同。随后运行 perfDiagnostics，应该看到 action=diagnostic。若失败，会返回 step=read_sequence/write_properties/read_back；不输出原始异常内容。

手动编辑器函数使用已保存源码，因此这一步可以在更新 Web App 部署前测试。自检成功后，将现有 Web App 发布为新版本，再等待真实慢请求并运行 perfDiagnostics。无需更新前端或 setup。

本地完整回归：103 项通过、0 失败。新增 held 禁写、释放后可写、9 秒自检、统一 finally、获取锁失败、释放失败恢复/未确认释放时禁写、不重复成功释放、保存失败不影响响应等验证。尚未在用户生产环境执行自检，不声称已经定位到线上漏存的唯一原因。
