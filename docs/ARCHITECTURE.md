# 阶段 1：架构与自检

## 系统与数据流

Android Chrome 安装独立 HTTPS PWA（GitHub Pages）→ IndexedDB 原子提交当前活动、完成事件、UUID 操作队列 → Google 登录 → 隐藏表单 POST 到 Apps Script → 校验 Google RS256 ID token 与账号 sub → ScriptLock → 版本检查 → 持久化写入计划 → 年度 Raw 与每日统计绝对值更新 → 当前状态与版本提交 → UUID 回执 → 本地删除已确认队列。

按钮不等待网络。锁屏恢复通过持久化 start_at 与当前时间相减，不依赖计时器运行。数据成功写入 IndexedDB 后才显示记录成功。请求超时保留相同 UUID 重试。队列和当前活动存在一个 IndexedDB 事务中。跨标签页共享存储，并通过 Web Locks 防止同时发送。多设备冲突不自动覆盖：冻结同步，导出本地副本，明确选择保留云端状态后恢复；原队列保留在冲突副本中。

## Drive 文件结构

```text
TimeTracker/
  Master/TimeTracker_Master    # 固定状态、配置、年度文件索引、年度累计
         OperationIndex/       # 256 个 UUID 前缀索引文件，按需创建
  Raw/TimeLog_2026             # events, daily_summary, operations_01…12
      TimeLog_2027
  Backup/2026/                 # 月度与年度 CSV、JSONL、manifest
  Config/config.json           # 配置快照
```

与建议相比，daily_summary 也按年分片，避免自定义事件不断增加导致 Master 膨胀。每年最多约 366 个日汇总行；动态科目与分类存 JSON 字段，同时常用科目有固定秒数字段，标准二维表无合并单元格。Master 年累计每年一行；全历史查询读取这些年汇总，月周查询只读对应年度的 daily_summary，首页不扫描 Raw。

## Schema

Raw 必须字段：event_id(UUID), start_at,end_at(UTC ISO 8601),duration_seconds(整数),event_name,category,note,timezone(IANA),source,created_at,updated_at,schema_version。额外 event_key(稳定配置 ID)、revision、deleted(墓碑)、text_originals_json(公式前缀或单引号开头文本的标准 JSON 原值)。保护表格公式时可能增加前置单引号，原值字段与 JSONL 确保无损恢复。删除与跨年移动旧行保留墓碑，查询与备份剔除墓碑；同一事件只有一条有效行。修改名称不改旧记录语义；按 event_key 累计可跨名称变化，学习按记录当时 category=学习 判断。

每日行：date,total_seconds,study_seconds,math_seconds,408_seconds,english_seconds,cs50p_seconds,fitness_seconds,commute_seconds,entertainment_seconds,fragmented_seconds,by_event_json,by_category_json,schema_version。全部存秒数。年度累计包含相同动态映射。

当前状态：revision,current,config,last_operation_id。操作：op_id,queued_at,device_id,base_revision,type,payload。一次操作最多改 24 条记录，单条跨度最多 366 天，防止误触形成百万日数据。队列按顺序提交。

## 可靠写入与修改

Sheets 无跨表事务。服务器先计算原始记录后像、每日汇总后像和年度累计后像，将完整确定性计划写入 Drive 临时文件，将文件 ID 与 SHA-256 指针写入 Master pending；flush 后再执行。恢复重复执行相同绝对值，不进行重复加法。当前状态最后提交，再清 pending。每个请求与定时任务先恢复 pending。操作日志记录请求 SHA-256，UUID 相同但内容不同拒绝。即使回执丢失也能重试。发生配额错误暂停同步，不清队列。不能直接编辑 Raw 表：使用 App 编辑、拆分、删除；如果手动改表，运行 rebuildYear(年份) 重算，或用备份恢复工具。服务端版本冲突显式拦截。

## 时间与归档

跨年案例：2026-12-31 23:50 → 2027-01-01 00:20，Asia/Shanghai。完整原始事件保存在 TimeLog_2026；2026-12-31 汇总 600 秒，2027-01-01 汇总 1200 秒。分界用 IANA 时区的当地午夜换算 UTC；夏令时日可能 23 或 25 小时。每段先用累计毫秒向下取整之差计算秒，确保所有日段之和严格等于 duration_seconds。改变默认时区只影响后续事件；历史保持原 timezone。

## 安全方案

公开 Apps Script Web App 以所有者执行，但每次数据请求都验证 Google ID token 的 RSA 签名、kid、aud、iss、exp、iat、email_verified 与允许账号。第一次受允许邮箱登录后固定 sub，后续以 sub 为身份依据。只请求身份，无前端 Drive 写权限。Google JWKS 公钥短期缓存，未知 kid 重新拉取。公开 Client ID 不是密钥。登录 token 只在页面内存中，过期需重新登录；离线仍可记录，登录后再同步。拒绝未知前端 origin，回执只 postMessage 到允许的精确 origin，并使用请求随机 nonce。前端必须防 XSS；所有用户字段以 textContent 渲染。表格纯文本格式并转义公式前缀，CSV 也防公式注入。

隐藏表单/HtmlService 回执避免跨域预检与把 token 放 URL。此桥接需部署后在 Android 检验；Google 的 iframe 或身份策略变化可能影响桥接，故提供可直接从 Apps Script 编辑器运行的诊断，不能把模拟测试称为实网验收。

## 长期策略与边界

每月和年度自动开放格式快照，包括记录数、生成时间、schema_version、SHA-256、配置、当前活动、汇总与文件索引。定时任务每天运行、补漏，并轮流刷新历史快照，以覆盖迟到离线记录和旧记录编辑；手动 backupYear 可立即刷新。操作去重与事件定位共用 256 个 UUID 前缀索引文件，避免改 queued_at 绕过去重；备份版本文件不覆盖，最近 manifest 指向当前版本。恢复先校验 checksum 与字段，浏览器按批导入，每批通过正常事务更新汇总；空库恢复完整副本，不自动覆盖已有库。恢复当前活动需单独明确确认，防止恢复过期活动。

100 年目标是数据格式、分片与迁移能力，不是任何免费云平台的永久承诺。按每天 100 次切换，每年约 36,500 行，事件与操作日志远低于当前 Sheets 1000 万单元格限制；默认按年分片，超过配置的年度记录上限拒绝并保留队列，需迁移至月度分片或其他数据库。100 年日汇总约 36,525 行分布在年度文件，Master 仅约 100 行年累计与索引。浏览器容量与 Drive 空间都有限；导出离线队列、请求持久存储、每年将备份另存电脑/其他介质，避免单一账户故障。手机被杀后浏览器不会保证后台同步，重新打开会补传；不要卸载/清站点数据前清空待同步队列。

Apps Script 有执行时长、触发器和每日配额，功能不依赖精确触发时间；备份按日期补漏。长历史批量导入分批完成；年度重建维护工具是按年运行，百年修复逐年执行。schema_version=1，不支持的版本拒绝导入，未来迁移按年度复制到新文件、校验总秒数和 UUID，再切索引，保留旧文件和备份。

## 自检

- 无限增长：Raw、日汇总与操作日志按年；Master 仅年度索引和累计。
- 提交中断：pending 计划可恢复；回执丢失有幂等日志。
- 跨年修改：先墓碑旧归档，再 upsert 新归档；差量日汇总和年汇总在同一恢复计划内。
- 多设备：乐观版本锁；不悄悄覆盖离线活动。
- 本地数据：IndexedDB 持久化不能代替异地备份，前端显示待同步数量。
- Google 登录、桥接、触发器：本地测试能验证逻辑，真实账号部署后仍需集成验收。

官方参考（2026-10-10 核查）：
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/reference/html/x-frame-options-mode
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/guides/support/best-practices

