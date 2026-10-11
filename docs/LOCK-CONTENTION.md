# 频繁云端锁超时修复

## 已确认的代码问题

- doPost 在拿到共享锁以后执行 Google JWKS 获取/验证，网络耗时扩大持锁区间。
- maintenance / backupYear 在生成、上传全部备份文件期间持锁。
- sync_batch 固定处理最多 10 条；每个 commit 包括 Sheets/Drive durable recovery I/O，整批可能超过浏览器 45 秒等待时间。浏览器超时不会取消服务器脚本。
- 前端 sync、query、records 可能相互并发；新 act 的 300ms 同步定时会缩短失败后的重试等待。

尚未读取用户线上 Apps Script 执行日志，不能断言哪项是本次截图的实际持锁者。

## 修改

Auth.gs：完整 RSA/audience/issuer/exp/owner 校验移到获取锁之前；首次 OWNER_SUB 绑定仍在锁内，且重新校验并发绑定。tryLock(1000) 失败返回 BUSY + retry_after_ms，未获取锁时不读取数据、不运行恢复、不写队列。已获锁请求在 finally 释放，并记录 action/lock_ms，不记录 token 或记录内容。

Repository.gs：doPost 传入 20 秒批次预算。只在两个 commit 之间检查，绝不打断单个 pending→apply→state/receipt→clear 顺序。超预算返回 YIELD、confirmed 前缀、state、failed_index；未确认后缀留在本机。20 秒不是硬性执行上限，单个慢 commit 仍可能超出。

Backup.gs：在锁内捕获一致快照；释放锁后写不可变备份文件；重新获取锁后，只有 pending 为空且 revision 未变化才发布 backup_index 和 config.json。期间发生提交时，不把旧快照标记为已覆盖新数据，原 dirty 标记保留。未发布的不可变文件可能保留在 Drive，下一轮备份会重试，不删除原有文件。自动维护拿不到锁便退出，让前台同步优先。

app.js/ux.js：同一页面内所有云端请求串行；BUSY 至少冷却 15 秒并加随机抖动；网络超时冷却至少 60 秒；切换活动、手动同步不能绕过冷却。部分提交回执仍经过前缀校验才删除队列。旧后端的 Lock timeout 也转换为友好提示：“云端暂忙，记录已保存在本机，稍后自动重试。”跨设备仍由服务端锁保证一致性。

采用 tryLock 的语义见 [Google 官方 Lock 文档](https://developers.google.com/apps-script/reference/lock/lock)。没有删除数据锁或减少恢复用 flush。

## 测试

构建成功，85 项 Node 测试通过，0 失败。新增 8 项覆盖 BUSY 零写入、锁前认证与锁内 owner 重检、批次中途让出并重放、备份上传无锁、并发提交时不发布过期备份、点击不绕过冷却、云端请求串行/超时冷却、YIELD 前缀确认。

已有 RSA、安全校验、96 个批次持久化中断点、UUID 去重、revision conflict 和 Android 快捷输入回归全部通过。

## 生效步骤

1. 将 backend/Auth.gs、backend/Repository.gs、backend/Backup.gs 更新到现有 Apps Script 项目。
2. 在“部署 → 管理部署 → 编辑”中选择新版本并部署，保持原 /exec 部署网址与访问权限。不重新 setup，不新建数据目录。
3. 发布更新后的前端（app.js、ux.js、sw.js；可发布整个 frontend 目录）。
4. 关闭并重新打开 PWA，等待原 pending 队列自动同步；不要清除站点数据。
5. 若仍频繁暂忙，查看 Apps Script 执行日志的 action/lock_ms。这可以区分慢 commit、历史索引读取和维护捕获快照，进一步针对实际耗时优化。

当前仅完成本地修改与验证，未发布到云端。稳定标签 v1.0-mobile-stable 保持不变。
