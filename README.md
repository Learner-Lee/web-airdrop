# QuickDrop · 网页互传

手机与电脑之间的网页文件／文字互传工具。使用 WebRTC DataChannel，优先直连，必要时通过 TURN 中继；服务器不保存文件内容。

在线体验：[QuickDrop](https://web.alenli.cn/quickdrop/) · [作品展示](https://web.alenli.cn/about)

## 目录

- `quickdrop/`：可独立运行的互传服务、前端、测试和部署模板。
- `blog-about/`：已有 Next.js 博客的关于页接入代码，包含原地展开卡片、体验入口和小猫模拟加载条。这是博客的局部代码，不是独立 Next.js 项目。
- `QuickDrop-完整项目文档.md`：原始 MVP 设计与项目说明；当前实现请同时参阅 `quickdrop/README.md`。

## 本地运行

需要 Node.js 20 或更新版本。

```bash
cd quickdrop
npm ci
PUBLIC_URL=http://localhost:3031 npm start
```

打开 `http://localhost:3031/quickdrop/`，在另一浏览器中打开同一配对链接，核对两端配对码后即可发送。

```bash
npm test
```

测试中的 ZIP 独立校验还需要 Python 3；运行互传服务本身不需要 Python。

## 功能与边界

- 二维码／链接配对，两台设备之间发送文件、文字和链接。
- 双端配对码确认、逐文件接收确认、SHA-256 文件校验。
- 单文件最大 100 MiB；一次选择多个文件只需确认整组一次，任务明细折叠展示，全部校验完成后统一下载 ZIP（解压得到一个文件夹）。每组最多 50 个、合计最多 300 MiB。
- 微信、QQ 文件需先保存到系统文件目录，再从网页中选择；网页不能直接读取聊天内容。
- 双方需保持页面打开。没有离线收件箱、断点续传或后台传输保证；收到文件后需点击下载保存。
- 关于页桌面两列、手机单列，卡片原地展开为单列详情；小猫加载条使用模拟进度，内容未就绪时最多停在 99%。

运行配置与部署说明见 [quickdrop/README.md](quickdrop/README.md)。生产密钥、依赖目录、浏览器测试产物和本机临时文件不进入 Git。
