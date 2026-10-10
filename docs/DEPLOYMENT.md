# 从零部署：GitHub Pages + Apps Script + Google 登录

准备：你的 Google 账号、GitHub 账号、电脑浏览器。无需付费数据库或服务器。发布的是空白应用代码，不要把本地导出的私人记录上传到公开 GitHub 仓库。

## 1. 准备本地文件

1. 打开本项目目录 `time-tracker`。
2. 地址栏输入 `powershell` 并回车，打开终端。
3. 输入 `node scripts/build.cjs` 并回车。它生成 Core.gs、实际 PNG 安装图标、按内容版本化的 service worker。
4. 输入 `node --test tests/*.test.cjs`。看到 fail 0 后继续。

## 2. 建立 GitHub 仓库并发布前端

1. 登录 https://github.com/ 。右上角“+”→“New repository”。
2. Repository name 填 `time-tracker`，普通免费账号选择 Public。不要上传私人数据。
3. 点击 Create repository。
4. 用 GitHub Desktop 的“Add local repository”选择本项目目录；“Publish repository”发布到这个仓库。若使用网页上传，进入仓库“Add file → Upload files”，上传项目文件和文件夹，保留目录结构；隐藏目录 `.github/workflows` 也必须上传。不要上传 `.git`。
5. 进入仓库 Settings → Pages。在“Build and deployment / Source”选择 **GitHub Actions**。
6. 进入 Actions 页面选择“Publish PWA to GitHub Pages”。如果首次 push 时 Pages 尚未启用，可以点击 Run workflow，branch 选择 main，再 Run workflow。
7. 等 build、deploy 都变绿色。展开 deploy 中的地址，或从 Settings → Pages 点击 Visit site。
8. 保存网页地址，例如 `https://你的用户名.github.io/time-tracker/`。实际地址以 GitHub 显示为准。
9. 对应的 **origin** 是 `https://你的用户名.github.io`，不包含 `/time-tracker/`，不带尾部斜线。下面两个地方都需要这个值。

若你用 GitHub Desktop，新建远程仓库和“Publish repository”二选一：Desktop 可以直接创建新仓库；已经在网页建好仓库，则配置该仓库远程后 Push。源代码已本地初始化 Git，可以用任意熟悉的 Git 客户端上传。

官方说明：[GitHub Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 3. 创建公开 OAuth Client ID

1. 打开 https://console.cloud.google.com/ ，用自己的 Google 账号登录。
2. 顶部项目选择器 → New project，名称填 `TimeTracker`，Create。选择这个项目。
3. 左侧搜索“Google Auth Platform”，进入“Get started”。界面名称可能随 Google 调整；若显示“APIs & Services → OAuth consent screen”，进入同一身份配置页面。
4. Branding：App name 填 `时间事件记录`，User support email 和 Developer contact information 填自己的邮箱。
5. Audience 选择 External（个人 Gmail）；测试阶段添加自己为 Test user。这里只使用身份登录，不申请 Drive/Sheets 前端权限。
6. Clients → Create client → Application type 选择 **Web application**。
7. Name 填 `TimeTracker PWA`。
8. Authorized JavaScript origins 添加第 2 步得到的 origin，例如 `https://你的用户名.github.io`。不填项目路径。
9. 如果需要电脑本地测试，可额外添加 `http://localhost:4173` 和 `http://127.0.0.1:4173`。真实后端 ALLOWED_ORIGIN 一次只允许一个 origin，本地联调后要改回正式 origin。
10. 点击 Create，复制 **Client ID**，末尾是 `.apps.googleusercontent.com`。Client secret 不需要复制、不需要放到 PWA。
11. 保存 Client ID，等几分钟让 Google 配置生效。

官方说明：[Google 身份登录设置](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)。

## 4. 建立 Apps Script 后端

1. 打开 https://script.google.com/ 。点击 New project（新建项目）。
2. 左上角将 Untitled project 改名 `TimeTracker Backend`。
3. 默认 Code.gs 的内容删除。点击文件旁“+”→ Script，依次建立：`Core`、`Repository`、`Auth`、`Setup`、`Backup`。界面自动加 `.gs`。
4. 打开本项目 `backend/Core.gs`，全选复制到线上 Core.gs。其他四个文件逐个同名全量复制，不要漏掉任何文件。Code.gs 保持空白或删除。
5. 点击左侧齿轮 Project Settings，勾选“Show appsscript.json manifest file in editor”。
6. 回到 Editor，点击 appsscript.json，把本地 `backend/appsscript.json` 内容完整复制进去。
7. 再进入 Project Settings，下方 Script Properties → Add script property，填写三行：

| Property | Value |
| --- | --- |
| OWNER_EMAIL | 你的实际 Google 登录邮箱 |
| GOOGLE_CLIENT_ID | 第 3 步复制的完整 Client ID |
| ALLOWED_ORIGIN | 第 2 步的 HTTPS origin，不含路径或尾部斜线 |

8. 点击 Save script properties。其他 ID 会自动建立，不要手工填写 OWNER_SUB。
9. 回到 Editor，顶部函数下拉选择 `setup`，点击 Run。
10. 第一次需要授权：Review permissions → 选择自己的账号 → 检查权限 → Allow。仅授权你自己创建并核对过的项目。如果 Google 显示未验证应用说明，这是个人脚本常见情况；先核对项目和账号，再按 Google 提供的流程由你自己完成。不要绕过浏览器的证书或网络安全拦截。
11. 等执行日志显示“初始化完成”。日志有 Master 表网址。Drive 中应出现 TimeTracker 文件夹，以及 Master、Raw、Backup、Config。
12. 顶部函数改选 `diagnostics`，点击 Run。确认日志：schema_version 1、bigint `24`、public_keys 至少 1、trigger_count 至少 1。
13. 左侧 Triggers（闹钟）查看 `maintenance` 每天一次。触发时刻是大约时间，不保证精确 03:00；任务会补漏。

## 5. 发布 Apps Script Web App

1. 右上 Deploy → New deployment。
2. 点击齿轮选择 Web app。
3. Description 填 `v1`。
4. Execute as 选择 **Me / 我**。
5. Who has access 选择 **Anyone / 任何人**。这里是端点可访问，不代表可以读取数据；代码会验证 Google token 与 OWNER_SUB。
6. 点击 Deploy。复制 Web app URL，形如 `https://script.google.com/macros/s/…/exec`。不要用 `/dev` URL。
7. 在浏览器单独打开该 URL，应只显示“后端已运行”，不显示任何私有数据。

学校 Workspace 可能禁止 Anyone 部署或外部应用；如果看不到该选项，使用允许个人脚本的个人 Google 账号，或先询问账号管理员。不要改成无鉴权接口解决。

官方说明：[Apps Script Web App 部署](https://developers.google.com/apps-script/guides/web)。

## 6. 连接与首次验收

1. 打开 GitHub Pages 正式网址。
2. 点击右上设置，Apps Script 网址粘贴 `/exec` URL，Client ID 粘贴第 3 步的值。
3. 点击保存连接。出现 Google 登录按钮，使用 OWNER_EMAIL 对应账号登录。
4. 等顶部显示云端已确认。首次登录会固定 OWNER_SUB，以后其他账号不能写入。
5. 点“数学二”，稍等，再点“408”。点“结束当前事件”。
6. 看到待同步数量变 0，打开 Drive / Raw / TimeLog_当前年 / events，应有两条记录，UUID 不同、时间连续、duration_seconds 为整数。
7. 查看 daily_summary，学习秒数应等于两条 duration_seconds 之和。打开 PWA 今日、本周、本月，均应一致（显示会舍去不足一分钟部分）。
8. 手机上断网后重复以上操作，重新打开仍能恢复当前活动；联网后打开设置登录，点立即同步，核对队列变 0 且 Raw 不重复。

不能只凭“后端已运行”判定联通。鉴权、POST 回执、实际 Sheets 写入和再次读取全部通过，才是云端部署成功。

## 7. OPPO A1 活力版 5G 安装

1. 在手机上用能正常访问 Google 登录和 Apps Script 的 Android 浏览器打开 **正式 HTTPS 网页**。推荐按 Google 官方流程用 Chrome；OPPO 自带浏览器的网页应用安装能力可能随版本不同。
2. 页面第一次在线加载完成后，先走第 6 步的连接和登录。
3. Chrome 右上角三个点 →“添加到主屏幕”→“安装”（部分版本显示“安装应用”）。确认名称 `时间事件`。若页面设置出现“安装到主屏幕”按钮，也可以点击它。
4. 返回桌面，点新图标。它应以独立窗口打开。
5. 点击设置 → 请求浏览器持久存储。是否批准由浏览器决定；没有批准也能用，但保留异地备份更重要。
6. 点一个事件，锁屏几分钟后再打开。开始时间应不变，已进行时长继续增长。
7. 再做一次断网切换 → 重开 → 联网登录同步的验收。

ColorOS 不同版本的设置名称会变化。如后台经常被关闭，可在手机设置搜索“应用耗电管理”“电池”找到当前浏览器的后台限制选项。无需依靠后台计时存活：App 根据时间戳恢复；但页面被系统关闭后无法保证后台同步，重新打开才会补传。

Google 服务如果在当前网络不可达，PWA 仍能记录到本机，但无法云端保存；顶部会保留待同步提示。投入长期使用前，必须验证手机网络能稳定完成登录与同步。

官方安装说明：[Android 网页应用安装](https://support.google.com/chrome/answer/9658361?hl=zh-Hans&co=GENIE.Platform%3DAndroid)。

## 8. 更新代码

1. 更新本地源文件，运行 build 和 tests。
2. 上传 GitHub，等待 Pages workflow 全部变绿。build 会生成新的缓存版本。
3. 后端变化时，全量替换相应线上 .gs 文件，Deploy → Manage deployments → 编辑 → Version 选 New version → Deploy。保留原 `/exec` 地址。
4. 手机关闭再重开网页。如果仍显示旧版，再刷新。队列保存在 IndexedDB，更新不会清除；不要通过清站点数据更新。
5. Schema 改版必须按架构文档制定迁移，不要改变现有字段含义。
