# 部署与验收记录

日期：2026-11-15（Asia/Shanghai）。

## v1.2 多文件整组传输

一次多选的文件作为一组，接收方只确认一次，双方均以一张任务卡汇总进度。文件明细在确认后和完成后保持折叠，可手动展开。全部文件逐一通过 SHA-256 校验后，在接收浏览器本地生成一个标准 ZIP，解压得到一个文件夹；保留空文件、中文名，同名文件自动编号。单文件的原下载流程保留。

每组最多 50 个文件、合计 300 MiB；单文件仍为 100 MiB。打包使用 ZIP STORE，不压缩文件内容、不上传到服务器，也不新增运行依赖。双方通过 `hello` 声明整组协议能力；新版向旧页面多选发送时会提示双方刷新重配，避免出现无人处理的接收请求。

验证记录：Node 共 6 组测试通过，含 CRC32 已知向量、Python 标准库独立读取 ZIP、中文／重复／危险路径名与空文件、50 文件上限，以及 HTTP/WS 协议测试。正式站浏览器通过一次确认的 4 文件任务（含 50 MiB 样本）、折叠展开、下载 ZIP 内全部文件 SHA-256 比对、整组拒收、接收前取消、完成一个文件后取消、后续文件损坏、元数据与已接受清单不符；失败任务均没有提供残缺 ZIP。原文本、单文件、大小上限、第三设备拒绝、断线恢复与窄屏布局回归也通过。

强制 TURN 中继的一次连接已成功完成 4 文件整组确认、ZIP 下载和独立哈希校验（含 1 MiB 样本、中文同名文件、空文件）。后续中继断线重配出现 ICE 候选收集超时，另一次复测也出现连接超时，因此不能把本次结果描述成中继重连的完整稳定性验收；已有的网络连接限制仍需真实设备／网络矩阵排查。本次没有调整 ICE 或 TURN 配置。

更新前源码备份：`/storage/backups/quickdrop-before-batch-20261115T012615Z.tar.gz`。本次仅更新 QuickDrop 服务，无需重建博客镜像；未修改文章、作品数据或原 PDF 工具。上线后双方需刷新页面并重新配对。

## 在线地址与代码

- 作品列表：`https://web.alenli.cn/about`
- QuickDrop 展开：`https://web.alenli.cn/about?work=quickdrop`
- PDF 对照展开：`https://web.alenli.cn/about?work=web-pdf`
- 旧 `/about/quickdrop` 与 `/about/web-pdf` 链接会转到上述原地展开状态。
- QuickDrop 工具：`https://web.alenli.cn/quickdrop/`
- 原 PDF 工具：`https://web.alenli.cn/pdf/`
- 博客：`/storage/blog/2025-blog-public`
- 互传源码：博客目录下的 `module/quickdrop`
- 关于页改动：`src/app/about`，共享数据加载器读取挂载的 `public/data/about.json`。
- 数据宿主路径：`data/config/about.json`；保留原 PDF 记录，新增 QuickDrop 记录。

## 页面行为

桌面两列、手机单列。卡片显示封面、名称、年份、简介、标签，缩略状态即可点击在线体验／源码链接。悬停放大到 1.025 倍并上移 4px，系统偏好减少动态效果时关闭这段动画。点击封面或展开按钮后，选中的原卡片通过布局动画扩大为单列详情，地址不跳转、页面文档不重载；收起按钮或 Escape 恢复列表。旧独立详情链接兼容到列表展开状态。编辑模式保留原字段、封面修改、添加和保存流程，编辑时使用单列布局。

详情正文按需加载。等待时页面底部显示小猫跳动的模拟进度条，约 6.2 秒到 99% 后保持等待；Markdown 内容真正准备好才到 100%，随后显示正文。关闭详情会清理加载条的计时器。增加 `/about/loading.tsx` 作为服务器页面请求期间的同款等待界面。

本次追加验收通过：`test/about-inline.mjs` 在正式站确认两列悬停效果、缩略体验链接、原地展开且页面文档未重载、收起与 Escape、手机排版及原编辑功能、旧详情链接兼容。测试主动延迟详情脚本，确认进度稳定保持 99%、小猫 CSS 动画持续、正文仍隐藏；放行脚本后才完成加载并显示正文。小猫使用独立 CSS Module，桌面截图和手机截图已查看。`test/about.mjs` 保留为此脚本的兼容入口。

为避免重复复制依赖与构建缓存，新增 `.dockerignore` 排除 `node_modules`、`.next`、`.open-next`、`.wrangler` 和 Git 元数据；没有删除这些目录或持久化数据。生产构建成功，类型检查与改动前的既有错误输出一致。

## 已完成验证

- Node HTTP/WS 协议测试 3 组通过：静态与安全响应头、二维码、房间配对、第三设备拒绝、信令转发、离开重进、无效输入、跨源拒绝。
- 正式站独立 Chrome 浏览器上下文：DTLS 指纹配对码一致；确认前不可发送；中文、emoji、URL 双向传送；脚本文本按文本显示。
- 文件下载后外部 SHA-256 比对：1 MiB 与 50 MiB 二进制文件一致；反向零字节文件可下载。
- 多文件顺序队列、拒收、超过 100 MiB 拒绝、未知房间、第三设备拒绝、断线中止与重新配对通过。
- 故意更改一块发送数据后，接收端 SHA-256 校验失败并拒绝生成下载链接，发送端收到失败回执。
- 强制 `iceTransportPolicy=relay` 的公网端到端测试通过：界面明确显示中继，文字、1 MiB 文件下载哈希、空文件、拒收与断线重连通过。分别检查 UDP 与 TCP TURN URL 均能收集 relay 候选。
- 中继测试曾出现一次候选收集超时，之后单独探测与端到端复测通过；不据此承诺所有网络均能连通。
- `/about` 浏览器验收：桌面同一行两张卡片、悬停实际宽度增大、手机垂直排列、列表不展开详情、两作品详情跳转、详情刷新、在线体验打开、编辑后取消、404 均通过。
- 已检查桌面与 390px 窄屏截图；浏览器无未捕获页面错误。关于页自动化测试屏蔽了原站字体 CDN 和统计请求，以避免第三方请求超时干扰界面测试。
- 博客 Docker 生产构建通过。全量 `tsc --noEmit` 在改动前后均有同一处既有首页类型错误（`src/app/(home)/config-dialog/home-layout.tsx:42`，`hatCard.offsetX` 的 null/number 类型），前后输出一致，本次没有新增类型错误。
- QuickDrop `npm audit --omit=dev`：0 个已知漏洞。`ws` 已升级至修复版本 8.23.0。
- HTTPS 首页、详情、原 PDF 页面和 QuickDrop 健康检查返回正常；QuickDrop、coturn、Nginx 运行正常；QuickDrop 与 coturn 已设置自启。

## 服务与保护

- QuickDrop：systemd `quickdrop.service`，以独立 `quickdrop` 用户运行，仅监听 `127.0.0.1:3031`；内存上限 256 MiB。
- Nginx：`/quickdrop/` 反向代理及 WebSocket 升级；关闭此路径的访问日志，避免配对 token 进入访问日志。
- 生产密钥仅在 `/etc/quickdrop.env` 和 `/etc/turnserver.conf`；源码和此记录不包含密钥。
- TURN：主机 coturn，公网 `107.173.25.107:3478`（UDP/TCP），中继 UDP `49160–49200`。临时 HMAC 凭证、连接配额、带宽配额、私有地址禁用；相应 UFW 规则已添加。没有配置 TURN/TLS。
- 原博客与 PDF 服务保留。未执行 `rm`、Git reset、镜像清理、数据清理或服务器重启。传输过程中产生的 macOS 元数据文件移入备份目录，未永久删除。

## 备份与回滚

备份目录：`/storage/backups/quickdrop-20261114T154751Z`，仅 root 可访问。

- `manifest.json` 对应部署前的 Nginx、coturn、关于页配置和源文件备份。
- `about-before-grid.tar.gz`：加入 QuickDrop 后、两列改版前的完整 `src/app/about`。
- `about-before-inline-cat.tar.gz`：原地展开和小猫加载条改版前的完整 `src/app/about`。
- Docker 镜像 `2025-blog-public-blog:before-quickdrop-20261114`：加入 QuickDrop 前。
- Docker 镜像 `2025-blog-public-blog:quickdrop-before-grid-20261115`：QuickDrop 接入后、两列改版前。
- Docker 镜像 `2025-blog-public-blog:before-inline-cat-20261115`：原地展开和小猫加载条改版前。

回滚时先核对目标版本，备份当前状态；可恢复选定镜像标签后执行 `docker compose up -d --no-build blog`。关于页源码可从对应归档恢复，作品数据按 manifest 中的路径逐项恢复。Nginx 恢复后必须先 `nginx -t`，再 reload。不要覆盖 `data/blogs`、`.env.local` 或清理原作品文件。工具服务独立运行，单纯回滚列表版式无需停止它。

## 尚未覆盖的验收边界

未使用真实 iPhone／Android、微信／QQ 客户端和手机 5G 网络进行组合测试。窄屏 Chrome 测试只验证布局。微信／QQ 的支持方式是先将聊天文件保存到系统文件目录，再在网页选择；没有读取聊天记录或应用私有目录的功能。

双方需在线并保持页面运行；没有后台持续传输、断点续传或离线文件库。文件在浏览器内存中接收，关闭页面会失去未保存内容；“接收并校验成功”不等同于已保存到磁盘。单文件上限 100 MiB，本页累计保留文件上限 300 MiB。
