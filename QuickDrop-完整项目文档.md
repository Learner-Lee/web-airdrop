# QuickDrop — 局域网与跨网络网页互传系统

**完整项目文档（基于 MVP v1.0.0 源码）**

| 文档属性 | 内容 |
|---|---|
| 项目名称 | QuickDrop |
| 项目定位 | 手机、电脑间无需安装 App 的网页文件与文本互传工具 |
| 源码版本 | `package.json`：`1.0.0` |
| 文档版本 | 1.0 |
| 编写日期 | 2026-11-14 |
| 技术栈 | 原生 HTML/CSS/JavaScript、WebRTC DataChannel、Node.js、`ws`、`qrcode`、Caddy、coturn |
| 项目阶段 | **可用于学习和验证的 MVP；尚未完成真实多设备端到端验收，非生产就绪** |
| 适用读者 | 产品负责人、前端/后端开发、部署运维、测试人员 |

> **阅读说明**：本文依据提供的 `quickdrop-mvp` 源代码逐项整理。标记“当前已实现”仅代表源码中有实现，不代表已在所有设备、浏览器和网络环境验证成功。标记“规划”或“建议”的内容并未包含在现有代码中。示例域名 `drop.example.com`、`turn.example.com` 均需替换。

## 目录

1. 项目概述与目标
2. 需求规格说明（PRD）
3. 技术选型与总体架构
4. 代码结构与模块设计
5. 房间、信令与文件传输协议
6. 数据结构、状态与限制
7. 本地开发与调试
8. Ubuntu VPS 公网部署
9. 安全设计、威胁模型与隐私
10. 测试方案与验收标准
11. 运维、监控和故障排查
12. 性能、扩展性及成本分析
13. 版本规划与迭代任务
14. 交付清单与上线检查表
15. 术语表与参考链接

---

## 1. 项目概述与目标

### 1.1 问题背景

常见的手机和电脑互传方式依赖特定生态、安装客户端、即时通信软件或第三方云盘。QuickDrop 试图通过浏览器覆盖 iPhone、Android、macOS、Windows 和 Linux，减少安装、注册和设备生态限制。

### 1.2 产品目标

- **零安装**：双方通过浏览器访问同一网站，无需原生 App。
- **低门槛配对**：一端创建临时房间，另一端通过二维码或配对链接加入。
- **文件与文字**：发送照片、视频、文档等文件，以及短文本和链接。
- **尽量直连**：使用 WebRTC ICE 协商可行的点对点链路；不可直连时通过 TURN 中继。
- **尽量少留存**：当前后端只保留短期房间和信令状态，不建立文件库与用户数据库。
- **操作可见**：有接收确认、传输进度和结果提示。

### 1.3 用户角色与典型场景

| 用户/场景 | 操作 | 目标结果 |
|---|---|---|
| Mac → iPhone（同一 Wi-Fi） | 电脑创建房间，手机扫码，电脑发送 PDF | 手机接收并点击下载 |
| iPhone 5G → Windows 宽带 | 手机与电脑打开同一配对链接，发送照片 | 通过 WebRTC 直连或 TURN 中继完成传输 |
| 手机 → 电脑发送网址 | 输入 URL 后点击“发送文本” | 对端展示可复制的文本 |
| 陌生设备安全确认 | 发送方选择文件，接收方点击“接收” | 未被接受前不发送文件二进制内容 |

### 1.4 设计原则

浏览器优先、最小可用功能优先、默认不在服务器存储文件、逐步增强安全与可运维性。**目前配对链接是类似 bearer token 的访问凭据，不能等同于经过验证的设备身份。**

### 1.5 明确的非目标（当前版本）

不支持用户注册、多用户群发、历史记录、云端离线收件箱、后台持续传输、断点续传、浏览器直接流式写盘、真正的端到端身份认证或文件级哈希校验。

---

## 2. 需求规格说明（PRD）

### 2.1 功能需求与实现状态

| 编号 | 需求 | 当前状态 | 代码依据 / 备注 |
|---|---|---|---|
| F-01 | 创建随机临时房间 | 已实现 | `server.js` 中 `create`，18 字节随机值经 base64url 编码 |
| F-02 | 使用链接或二维码加入 | 已实现 | `GET /qr?room=...`，`join` |
| F-03 | 每房间最多两台设备 | 已实现 | 房间 `clients.size >= 2` 时拒绝 |
| F-04 | WebRTC 文件直传 | 已编写 | `RTCPeerConnection` + `RTCDataChannel` |
| F-05 | 跨网络 STUN/TURN | 已编写配置接口 | 实际可用性取决于 TURN 服务/网络/ICE 协商 |
| F-06 | 文本与链接传输 | 已实现 | `text` 控制消息；没有持久历史 |
| F-07 | 文件接收或拒绝 | 已实现 | `file-meta`、`file-accept`、`file-reject` |
| F-08 | 多文件顺序发送 | 已实现 | 文件选择器 `multiple`，`sendFiles()` 串行处理 |
| F-09 | 进度显示 | 已实现（基础） | 发送端显示排队发送字节比例；接收端显示已收字节比例 |
| F-10 | 接收结束后下载 | 已实现 | 接收端 Blob + Object URL + 下载链接 |
| F-11 | 房间过期与心跳 | 已实现 | 房间创建后约 60 分钟到期；30 秒清理周期与 WS ping/pong |
| F-12 | 文件大小限制 | 已实现 | 单文件 100 MiB；不限制同一会话累计文件个数 |
| F-13 | 断线恢复/续传 | **未实现** | 断连后通常需刷新与重新配对 |
| F-14 | 传输文件哈希校验 | **未实现** | 仅比较累计字节数与声明大小 |
| F-15 | 离线收件箱/云端文件 | **未实现** | 需要独立服务与存储架构 |
| F-16 | 设备身份验证/SAS 短码 | **未实现** | 当前持有链接即可尝试加入空余席位 |
| F-17 | 生产级限流/审计 | **未实现** | 当前仅有房间数、消息尺寸与基础 Origin 检查 |

### 2.2 非功能需求（目标与当前能力分离）

| 维度 | 当前事实 | 后续建议的验收目标 |
|---|---|---|
| 兼容性 | 使用通用浏览器 API；无设备实测记录 | 主流最新版 Safari/Chrome/Edge，桌面与移动端通过矩阵测试 |
| 安全 | HTTPS/WSS 需反向代理，DataChannel 采用 WebRTC 加密；匿名房间 | 加入设备校验码、频率限制、恶意文件提示、最小化日志 |
| 性能 | 16 KiB 分块，1 MiB 排队上限策略；无实测吞吐报告 | 在明确网络和设备条件下记录 P50/P95 耗时、失败率 |
| 可靠性 | 无断点续传；进程重启清空房间 | 连线重试、失败超时、文件哈希、断点续传 |
| 可维护性 | 原生 JS + 单 Node 服务；没有自动化测试文件 | 单元/协议/端到端测试，CI、格式化、版本锁定 |
| 可观测性 | 控制台日志，systemd/coturn 可查看运行日志 | 结构化日志、健康检查、指标告警；不记录文件内容 |

**MVP 验收定义（建议）**：在指定两种浏览器、指定 Wi-Fi 和移动数据条件下，完成房间配对、文本互传、1 MiB/50 MiB 文件双向收发、拒绝文件、断线处理、第三设备拒绝等测试。验收不能仅凭“页面能打开”判断。

---

## 3. 技术选型与总体架构

### 3.1 技术栈

| 层次 | 技术 | 职责/原因 |
|---|---|---|
| UI | HTML5 + CSS3 + 原生 JavaScript | 不依赖框架，便于理解与快速部署 |
| P2P/文件承载 | WebRTC `RTCDataChannel` | 端到端浏览器传数据、可靠有序通道与加密 |
| 连接协商 | WebSocket + SDP + ICE | 交换 offer、answer、ICE candidate；不承载文件流 |
| 信令服务 | Node.js 20+ + `ws` | 创建/加入房间、转发协商消息 |
| 二维码 | npm `qrcode` | 后端根据房间 URL 输出 SVG 图片 |
| STUN | 源码默认 `stun.l.google.com:19302` | 协助发现网络候选，存在外部依赖 |
| TURN | coturn | P2P 不可达时中继加密后的传输 |
| TLS/反向代理 | Caddy | HTTPS、WSS、证书自动化与代理 Node |
| 进程托管 | systemd | 开机自启和故障重启 |
| 数据库/对象存储 | **无** | 当前房间状态只在内存，文件在接收端内存暂存 |

### 3.2 逻辑架构图

```text
                      ┌──────────────────────────────┐
                      │      drop.example.com        │
                      │  Caddy HTTPS / WSS 443       │
                      └──────────────┬───────────────┘
                                     │ reverse_proxy
                      ┌──────────────▼───────────────┐
                      │ Node.js / WebSocket /ws:3000 │
                      │ create / join / signal       │
                      │ room map / QR / ICE config   │
                      └──────────────┬───────────────┘
                         SDP / ICE   │   SDP / ICE
                        ┌────────────┴────────────┐
                        │                         │
              ┌─────────▼─────────┐     ┌─────────▼─────────┐
              │ 手机浏览器 (A)    │     │ 电脑浏览器 (B)    │
              │ WebRTC Peer A     │◄═══►│ WebRTC Peer B     │
              └─────────┬─────────┘     └─────────┬─────────┘
                        │       尝试 P2P 直连       │
                        └────────────┬────────────┘
                                     │ 失败则走中继
                          ┌──────────▼──────────┐
                          │  turn.example.com   │
                          │  coturn 3478 + UDP  │
                          └─────────────────────┘
```

### 3.3 三种典型传输路径

- **路径 A：同一 LAN**。两端均能访问同一个信令服务，ICE 可能选择局域网可达候选（现代浏览器可能用 mDNS 隐藏主机 IP），文件走局域网设备间链路。**不代表无需服务器**，当前版本配对必须先连信令服务器。
- **路径 B：跨网络 P2P**。两端连接信令服务器，通过 STUN 获取候选并尝试 NAT 穿透；成功后文件不穿过 Node 服务器，也不经过 TURN。
- **路径 C：跨网络 TURN**。无法直连时，浏览器把 WebRTC 传输经 TURN 中继。此时 TURN 耗费流量、带宽和连接资源，但 Node 信令进程仍不接收文件内容。

### 3.4 为什么不是“所有文件都上传到后端”

WebRTC 模式降低服务端文件存储成本和隐私暴露面，并可发挥局域网带宽。代价是：双方必须同时在线、NAT/防火墙条件影响成功率，TURN 的部署与费用不可忽略，超大文件需要浏览器流式处理。若要“手机今天上传、电脑明天下载”，需另做对象存储/过期链接/访问控制。

### 3.5 基本信任边界

浏览器运行用户可见的前端；Node 可看到房间加入与 SDP/ICE 元数据；coturn 可看到中继层网络元数据和加密的 WebRTC 流量；接收设备在解密后获得真实文件。HTTPS 保护访问网站与信令；WebRTC DataChannel 使用 DTLS 加密传输。**当前没有认证“对端是不是你自己的设备”的短码核对机制**。

---

## 4. 代码结构与模块设计

### 4.1 当前源码目录

```text
quickdrop-mvp/
├── package.json            # npm 脚本、依赖和 Node 版本约束
├── .env.example            # 端口、公网地址和 TURN 环境变量示例
├── .gitignore              # 忽略 node_modules/.env 等
├── server.js               # HTTP 静态资源、二维码、WS 信令、房间、TURN 凭证
├── public/
│   ├── index.html          # 网页主体：设备、二维码、上传、文本、收件区
│   ├── style.css           # 响应式暗色 UI
│   └── app.js              # WebSocket、WebRTC、文件/文本传输与状态管理
├── deploy/
│   ├── Caddyfile           # HTTPS/WSS 反向代理模板
│   ├── turnserver.conf     # coturn 配置模板
│   └── quickdrop.service   # systemd 进程模板
└── README.md               # 原始运行说明
```

### 4.2 服务端模块与关键函数（`server.js`）

| 函数/对象 | 责任 | 设计重点 |
|---|---|---|
| `rooms: Map` | 房间 ID → `{clients, created}` | 只在当前 Node 进程内存在 |
| `iceServers()` | 返回 STUN 与可选 TURN 配置 | 按需生成 1 小时 TURN 临时凭证 |
| `makeRoomId()` | 生成房间 ID | `randomBytes(18)`，base64url 24 字符 |
| `isRoomId()` | 校验房间 ID 形式 | 正则校验字符和长度，不代表房间必然存在 |
| `exitRoom(ws)` | 离开房间并通知另一端 | 最后一个成员离开时删除房间 |
| `joinRoom(ws, id)` | 房间存在性/人数校验 | 最大两台；通知已有成员 |
| HTTP server | `GET /`、静态资源、`GET /qr` | 不接受上传 POST，不存储文件 |
| `WebSocketServer` | 处理 `create`、`join`、`signal` | 路径 `/ws`；消息负载 64 KiB 上限 |
| `sweep` | 到期清理与 ping/pong | 每 30 秒执行；房间 60 分钟 TTL |

### 4.3 客户端模块与关键函数（`public/app.js`）

| 函数/状态 | 责任 |
|---|---|
| `state` | 保存 WS、PC、DC、角色、房间、候选、收发状态 |
| `connectWS(roomId)` | 建立 `/ws`，创建房间或加入房间 |
| `ensurePeer()` | 构造 `RTCPeerConnection` 并绑定 ICE、DataChannel 事件 |
| `offer()` / `handleSignal()` | 生成并处理 SDP offer/answer、ICE candidate |
| `configureChannel()` | 绑定 DataChannel open/close/message 回调 |
| `handleControl()` | 解析数据通道 JSON 控制消息 |
| `handleBinary()` | 将二进制分块加入接收缓冲 |
| `waitBuffer()` | 等待发送缓冲降低，避免无节制堆积 |
| `sendOne()` / `sendFiles()` | 文件元信息发送、等待同意、分片传输、等待完成回执 |
| `resetPeer()` | 关闭旧连接并重置当前传输状态 |

### 4.4 前端页面组成

连接与配对区（连接状态、两台设备图示、二维码、配对链接、新建房间）；文件发送区（选择文件、拖拽、进度）；文本发送区（输入、发送、复制接收内容）；文件接收区（文件确认与下载）。页面不是 PWA，不存在服务工作线程或后台传输能力。

---

## 5. 房间、信令与文件传输协议

### 5.1 HTTP 接口清单

| 方法 | 路径 | 行为 | 典型返回 |
|---|---|---|---|
| GET | `/` | 首页（映射 `/index.html`） | `200 text/html` |
| GET | `/index.html` | 首页 HTML | `200 text/html` |
| GET | `/app.js` | 浏览器 JS | `200 text/javascript` |
| GET | `/style.css` | CSS | `200 text/css` |
| GET | `/qr?room=<id>` | 用房间 ID 生成包含访问链接的 SVG 二维码 | `200 image/svg+xml`；非法 ID `400` |
| WebSocket | `/ws` | 建立长期信令通道 | 正常情况下握手 HTTP 101 |
| HEAD/POST | 任意 HTTP 路径 | 未实现 | `405 Method Not Allowed` |

**注意**：当前没有 `/health`、`/api/upload`、`/api/download`、`/api/rooms` REST API；房间由 WebSocket 消息管理，不应在文档或前端调用中虚构这些端点。

### 5.2 WebSocket 协议（JSON）

**客户端 → 服务端：创建房间**

```json
{"type":"create"}
```

**服务端 → 客户端：创建/加入成功**

```json
{
  "type": "joined",
  "room": "24-char-base64url-room-id",
  "role": "host",
  "iceServers": [{"urls":["stun:stun.l.google.com:19302"]}]
}
```

其中 `role` 为 `host` 或 `guest`；跨网开启 TURN 后 `iceServers` 还可能含 `urls`、`username`、`credential`。示例房间字符串只是格式示意，实际服务端生成真实 24 字符 ID。

**客户端 → 服务端：加入房间**

```json
{"type":"join","room":"填入服务端实际生成的24字符房间ID"}
```

**服务端 → 已在房间的另一端**

```json
{"type":"peer-joined"}
```

**双向 WebSocket 透传协商消息**

```json
{
  "type": "signal",
  "data": {
    "type": "offer",
    "sdp": {"type":"offer","sdp":"...真实 SDP..."}
  }
}
```

`signal.data.type` 当前允许 `offer`、`answer`、`candidate`。ICE 示例：

```json
{"type":"signal","data":{"type":"candidate","candidate":{"candidate":"candidate:...","sdpMid":"0","sdpMLineIndex":0}}}
```

其他服务端通知：`{"type":"peer-left"}`；`{"type":"error","message":"房间已满（最多两台设备）。"}`。信令服务当前没有确认消息序号、会话恢复 token 或分布式房间路由。

### 5.3 建连时序

```text
电脑 A                  Node.js /ws                      手机 B
  |  create                 |                             |
  |------------------------>|                             |
  |  joined(host, room)     |                             |
  |<------------------------|                             |
  |                         |   join(room)                |
  |                         |<----------------------------|
  |  peer-joined            |   joined(guest, iceServers) |
  |<------------------------|---------------------------->|
  |  signal(offer)          |                             |
  |------------------------>|  signal(offer)              |
  |                         |---------------------------->|
  |                         |  signal(answer)             |
  |  signal(answer)         |<----------------------------|
  |<------------------------|                             |
  |<============== ICE / STUN / TURN 协商 ===============>|
  |<================ WebRTC DataChannel =================>|
```

本版本由已在房间的 `host` 在收到 `peer-joined` 后调用 `offer()`；新加入设备收到 `offer` 后生成 `answer`。ICE 候选可能与 SDP 协商交错到达，客户端用 `candidates[]` 暂存远端描述尚未就绪时收到的候选。

### 5.4 DataChannel 控制协议（不经过 WebSocket 服务端）

| type | 方向 | 字段 | 语义 |
|---|---|---|---|
| `text` | A → B | `text` | 发送文字/链接 |
| `file-meta` | A → B | `id`, `name`, `size` | 文件元信息，等待对端确认 |
| `file-accept` | B → A | `id` | 同意接收，发送端开始逐块发二进制 |
| `file-reject` | B → A | `id` | 拒绝接收 |
| 二进制帧 | A → B | ArrayBuffer | 文件片段，没有单独 JSON 包装 |
| `file-done` | A → B | `id` | 发送端已排队发送全部数据块 |
| `file-ok` | B → A | `id` | 接收端校验累计字节数并建立下载链接 |
| `file-error` | B → A | `id` | 内容长度或传输处理异常 |

文件流程示例：

```text
发送方                                     接收方
  |   file-meta(id, name, size)               |
  |------------------------------------------>|
  |                 用户点击“接收”              |
  |<------------------------------------------| file-accept(id)
  |      ArrayBuffer chunk #1 ... #N         |
  |==========================================>|
  |   file-done(id)                           |
  |------------------------------------------>|
  |                   校验累计字节数 == size    |
  |                   new Blob(chunks)         |
  |                   创建“下载文件”链接         |
  |<------------------------------------------| file-ok(id)
```

**重要边界**：`file-ok` 代表接收方已经拼出 Blob 并显示下载链接，**不代表用户已把文件保存到设备磁盘**；当前源码也未计算 SHA-256 等文件哈希，不能把长度验证称为完整性强校验。

### 5.5 分块与背压机制

- 单文件最大 `MAX_FILE = 100 * 1024 * 1024` 字节（100 MiB）。
- 每块 `CHUNK = 16 * 1024` 字节（16 KiB），以 `file.slice().arrayBuffer()` 读取。
- 发送缓存高水位 `HIGH_WATER = 1 * 1024 * 1024` 字节。
- DataChannel 的低水位阈值设为 `256 * 1024` 字节；达到高水位时等待 `bufferedamountlow`。
- 通道创建为 `{ ordered: true }`，默认使用可靠有序传递；接收方将分块按顺序拼接。
- 发送完成以后还要等待对方 `file-ok`，才能在 UI 显示“发送成功”。

**潜在问题**：当前进度条统计“已向 DataChannel 提交的字节”，不是精确网络上传速度，也不是落盘进度；文件一旦发送完，等待 `file-ok` 没有单独的超时机制。接收端将所有块保存在 RAM，生成 Blob 时可能造成额外内存占用。

### 5.6 文本限制

发送端用 `TextEncoder.encode(text).length` 检查最大 **32 KiB UTF-8**；接收端还会检查字符长度不超过 32768。文本不经过数据库，也没有会话历史、已读状态或附件预览。

### 5.7 服务器限制与基本校验

- 最多 `MAX_ROOMS = 500` 个同时存在的房间（单进程内存限制），超出时拒绝创建。
- 房间最大两台 WebSocket 客户端，过期时间从**创建**而不是从最后活动时间计算。
- 房间 TTL 60 分钟，每 30 秒清理一次，可能在到期后最多约 30 秒才执行关闭。
- WS `maxPayload` 为 64 KiB；信令 `JSON.stringify(data)` 超过 32000 字符会被忽略。
- WS 连接后检查 `Origin` 的 host 是否等于请求 Host，缺失或跨源则关闭，**但这不是用户身份认证**。

---

## 6. 数据结构、状态与限制

### 6.1 服务端内存模型

```text
rooms: Map<roomId, {
  clients: Set<WebSocket>,
  created: number  // Unix 毫秒
}>
```

每条 WebSocket 还有 `id`、`roomId`、`isAlive` 等运行期字段。服务端没有 Users、Files、Transfers 等数据库表。Node 重启后所有房间失效；不能简单启动多 Node 进程并期待跨进程自动互通。

### 6.2 客户端运行期状态

`state.ws`、`state.pc`、`state.dc` 分别是信令通道、WebRTC PeerConnection、DataChannel；`room`/`role` 表示房间身份；`receiving` 保存正在接收的文件信息与 `chunks`；`outgoing` 是单个正在发送的文件及确认 Promise；`sending` 阻止同端同时启动两个发送任务。

### 6.3 典型状态机

```text
页面加载
  → WS 连接成功
  → 创建/加入房间
  → 等待另一台设备
  → SDP/ICE 协商
  → DataChannel open
  → 可发送文本/文件
     ├─ 发文件 → 元信息 → 待同意 → 分块传输 → 等待确认 → 成功
     ├─ 收文件 → 待确认 → 接收分块 → Blob 已就绪 → 点击下载
     └─ 断线/关闭 → 当前进度丢失；需要重新建立连接
```

### 6.4 当前方案必须接受的边界

1. 两端需要同时在线，且浏览器保持页面可运行。
2. 文件接收端在内存保存分块；大文件和移动端易触发内存问题。
3. 没有重试和恢复协议，不支持网络切换中的无感续传。
4. 浏览器后台节流、系统省电、iOS Safari 下载行为会影响体验。
5. 公开 TURN 时要考虑流量滥用与带宽费用。

---

## 7. 本地开发与调试

### 7.1 前置条件

- Node.js **20 或更高版本**、npm。
- 现代 Chrome、Safari、Edge 或 Firefox（实际设备兼容性需测试）。
- 可访问 npm Registry 的网络环境，首次运行需要安装 `ws` 和 `qrcode`。

检查：

```bash
node --version
npm --version
```

### 7.2 启动开发环境

在项目根目录：

```bash
npm install
npm run dev
```

`npm run dev` 使用 `node --watch server.js`；如果不需要自动重启，则 `npm start`。成功后预期打印：

```text
QuickDrop: http://localhost:3000
```

打开 `http://localhost:3000/`；一个窗口创建房间，第二个窗口或无痕窗口打开复制出来的配对链接。为了验证文件发送，可先测文字再发送 100 KiB 的普通文件。

### 7.3 `.env` 加载的注意事项（容易忽略）

当前 `server.js` **没有引入 dotenv**，`npm start` 中的 `node server.js` **也不会自动读取 `.env` 文件**。因此：

- 不配置 TURN 时，直接 `npm start` 即可本地测试（使用默认端口 3000）。
- 需要手动读取 `.env` 的开发启动方式（Node.js 20.6+）：

```bash
cp .env.example .env
# 编辑 .env，填入自己的配置
node --env-file=.env server.js
```

- 生产 `systemd` 模板通过 `EnvironmentFile=/opt/quickdrop/.env` 读取配置，不存在此问题。
- 不要将 `.env` 加入 Git；项目 `.gitignore` 已忽略它。

### 7.4 常用 npm 命令

| 命令 | 作用 | 注意 |
|---|---|---|
| `npm install` | 安装依赖 | 当前源码未包含 `package-lock.json`，安装结果可能随时间变化 |
| `npm start` | 执行 `node server.js` | 不读取 `.env` |
| `npm run dev` | 自动监视 `server.js` 重启 | 适合本地开发 |
| `npm test` | 执行 Node 内建测试运行器 | **项目当前没有自动化测试文件**；不能把它当通过验收 |
| `node --check server.js` | 服务器 JS 静态语法检查 | 不执行网络逻辑 |
| `node --check public/app.js` | 客户端 JS 静态语法检查 | 不代替浏览器测试 |

### 7.5 浏览器调试建议

1. F12 → Console 查看 WebSocket/ICE/DataChannel 异常。
2. Network → WS 过滤 `/ws`，查看握手及 JSON 信令。
3. Chrome 可使用 `chrome://webrtc-internals` 查看 ICE candidate pair 和连接状态；其他浏览器有相应调试入口。
4. 分别记录：浏览器版本、OS、网络拓扑、是否 VPN/代理、TURN 日志、发送文件大小与耗时。
5. **真实手机不要依赖 HTTP `http://192.168.x.x:3000` 作为稳定部署路径**；建议使用带有效证书的 HTTPS 域名以满足安全上下文/剪贴板等浏览器要求。

---

## 8. Ubuntu VPS 公网部署

### 8.1 目标拓扑与前提

假设单台 Ubuntu VPS，公网 IP 为 `YOUR_PUBLIC_IP`，有 DNS 管理权限，两个 A 记录都指向该 IP：

```text
drop.example.com  A  YOUR_PUBLIC_IP
turn.example.com  A  YOUR_PUBLIC_IP
```

需保证服务器网络/云安全组与系统防火墙开放：

| 协议/端口 | 用途 | 必须？ |
|---|---|---|
| TCP 22 | SSH 运维 | 按实际 SSH 端口开放 |
| TCP 80/443 | Caddy HTTP→HTTPS 与 HTTPS/WSS | 是 |
| UDP 3478 | TURN/STUN | 强烈建议 |
| TCP 3478 | TURN TCP | 建议 |
| UDP 49160–49200 | TURN 中继端口池（当前模板） | 是，使用模板时 |
| TCP 5349 | TURN/TLS（需另配证书与监听） | 可选，建议后续增加 |
| TCP 3000 | Node 进程 | **不要直接对公网开放** |

**前置软件**：Node.js 20+、npm、Caddy 2、coturn、OpenSSL、unzip、systemd。软件的具体安装源按所用 Ubuntu 版本选择官方/受信任仓库，不建议直接复制未知第三方脚本。

### 8.2 上传项目到服务器

在本地机器（示例 ZIP 名称以你下载的文件名为准）：

```bash
scp quickdrop-mvp.zip ubuntu@YOUR_PUBLIC_IP:/tmp/
```

通过 SSH 登录后：

```bash
sudo apt update
sudo apt install -y unzip openssl
sudo useradd --system --home-dir /opt/quickdrop --shell /usr/sbin/nologin quickdrop
sudo mkdir -p /opt/quickdrop
unzip -q /tmp/quickdrop-mvp.zip -d /tmp
sudo cp -a /tmp/quickdrop-mvp/. /opt/quickdrop/
sudo chown -R quickdrop:quickdrop /opt/quickdrop
cd /opt/quickdrop
sudo -u quickdrop npm install --omit=dev
```

`useradd` 如果提示用户已经存在，可以跳过该命令；`cp -a` 是复制项目目录内容，包括 `.env.example`。如果项目 ZIP 已包含后来生成的 `docs/`，也会一起复制。

### 8.3 环境变量

```bash
cd /opt/quickdrop
sudo cp .env.example .env
openssl rand -hex 32
sudo nano .env
sudo chown quickdrop:quickdrop .env
sudo chmod 600 .env
```

将 `openssl` 生成的值复制到下列 `TURN_SECRET`：

```ini
PORT=3000
PUBLIC_URL=https://drop.example.com/
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
TURN_SECRET=这里换成openssl生成的长随机密钥
```

| 配置 | 默认值/示例 | 是否必需 | 说明 |
|---|---|---|---|
| `PORT` | `3000` | 可选 | Node HTTP/WS 监听端口 |
| `PUBLIC_URL` | `https://drop.example.com/` | 公网建议设置 | 控制二维码里的地址；必须是用户可访问的 HTTPS 域名 |
| `TURN_URLS` | UDP/TCP 3478 两种 | 跨网可靠性建议设置 | 多项以英文逗号分隔，不能含未转义的逗号 |
| `TURN_SECRET` | 长随机字符串 | 使用 TURN 时必须 | 与 coturn 的 `static-auth-secret` 必须完全一致 |

如果 `TURN_URLS` 或 `TURN_SECRET` 缺失，`iceServers()` 只会提供默认 STUN；这意味着某些跨网络环境可能无法建立连接。

### 8.4 systemd 托管 Node 服务

项目模板 `deploy/quickdrop.service` 使用 `User=quickdrop`、`WorkingDirectory=/opt/quickdrop`、`ExecStart=/usr/bin/node server.js`、`EnvironmentFile=/opt/quickdrop/.env`，并启用 `ProtectSystem=strict` 等隔离项。

执行：

```bash
command -v node
# 如果不是 /usr/bin/node，请先修改 deploy/quickdrop.service 里的 ExecStart
sudo cp /opt/quickdrop/deploy/quickdrop.service /etc/systemd/system/quickdrop.service
sudo systemctl daemon-reload
sudo systemctl enable --now quickdrop
sudo systemctl status quickdrop --no-pager
sudo journalctl -u quickdrop -n 80 --no-pager
```

确认本机服务有响应（注意只支持 GET，**不要用 `curl -I` 做健康检查**）：

```bash
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/
```

应显示 `HTTP 200`。此处检查仅代表 HTTP 静态服务可访问，不等于 WebRTC 已正常。

### 8.5 部署 Caddy（HTTPS + WSS）

安装 Caddy 2 后将项目内模板调整为真实域名：

```caddyfile
drop.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

配置好 `/etc/caddy/Caddyfile` 后：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Caddy 的 `reverse_proxy` 会处理 WebSocket 升级；不需要单独建立 `/ws` 代理路径。TLS 证书能否正常获取取决于 DNS、80/443 可达性及 CA 验证。外网检查：

```bash
curl -fsS -o /dev/null -w 'HTTPS %{http_code}\n' https://drop.example.com/
```

### 8.6 部署 coturn（STUN/TURN）

```bash
sudo apt install -y coturn
sudo cp /opt/quickdrop/deploy/turnserver.conf /etc/turnserver.conf
sudo nano /etc/turnserver.conf
```

关键配置（示意，实际与项目模板一致）：

```ini
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=与TURN_SECRET完全相同的密钥
realm=turn.example.com
min-port=49160
max-port=49200
no-cli
no-multicast-peers
no-loopback-peers
```

如果 TURN 在 NAT 后面，根据 coturn 文档正确配置 `external-ip=公网IP/私网IP` 并做端口映射；如果 VPS 直接具有公网 IP，通常不必配置这一映射。某些 Debian/Ubuntu coturn 包还要求在 `/etc/default/coturn` 显式启用服务，请以本机安装包说明为准。

```bash
sudo systemctl enable --now coturn
sudo systemctl status coturn --no-pager
sudo journalctl -u coturn -n 100 --no-pager
```

**TURN 凭证机制**：Node 用当前 Unix 秒 + 3600 构造 `"过期时间:quickdrop"`，再以共享密钥 HMAC-SHA1 生成 Base64 密码，coturn 的 `use-auth-secret` 模式可校验这种临时凭证。这是 TURN 认证机制，**与文件加密校验、用户身份认证不同**。公网服务应进一步设置 TURN 用量和连接资源限额。

### 8.7 防火墙配置（如果使用 UFW）

**先确保 SSH 被允许，再启用防火墙**，以免被锁在服务器外：

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49160:49200/udp
sudo ufw status
```

如果已有 UFW 策略，请按当前配置操作；不要重复盲目启用。云厂商控制台安全组也要配置相同的 TURN 端口。TCP 3000 应只允许本机/受控网段访问；当前 `server.js` 监听 `0.0.0.0`，不能只靠“Caddy 反向代理”就假设 3000 自动受到保护。

### 8.8 受限网络与 TURN/TLS（可选强化）

企业防火墙可能封锁 UDP，建议额外部署受信任 TLS 证书支持的 `turns:turn.example.com:5349?transport=tcp`（通常为 TCP 5349）。需要 coturn 中对应 TLS 监听配置及证书/私钥，不是仅往 `TURN_URLS` 添加字符串就能生效。配置完成后再开放 TCP 5349 并测试。

### 8.9 最小跨网验收

1. Mac/Windows 电脑用 Wi-Fi 打开 `https://drop.example.com/`。
2. iPhone/Android **关闭 Wi-Fi**，使用 4G/5G 扫码加入。
3. 检查双方均出现“设备已连接”。
4. 先发文本，再分别发 1 MiB 和 50 MiB 文件。
5. 观察手机是否出现下载链接并实际保存。
6. 如果失败，用浏览器 WebRTC 调试页面验证最终选择的候选类型、TURN 日志和 UDP/TCP 端口。

**生产部署特别提示**：当前方案没有用户级限流、身份认证、恶意流量防护或可观察性指标。即使以上步骤成功，也应先按小规模私用/内测服务运行，而非直接作为公开高并发产品。

---

## 9. 安全设计、威胁模型与隐私

### 9.1 已有的基础保护

| 控制 | 当前实现 | 限度 |
|---|---|---|
| 房间 ID 随机性 | 18 字节随机数，24 字符 base64url | 防猜测不等于设备身份验证 |
| 房间席位 | 最多 2 台设备 | 知道链接的第三方可能抢先占位 |
| 加密 | 部署 HTTPS/WSS + WebRTC DTLS | TURN 看不到 DataChannel 明文，但可以观察连接元数据 |
| Origin 校验 | 检查 WebSocket Origin host | 不能抵御所有非浏览器客户端或链接泄露 |
| 传输确认 | 文件发送前必须被对端接受 | 没有细粒度文件类型/内容检测 |
| XSS 防护 | 对文件名和文本多用 `textContent`；响应含 CSP | 需要进一步安全评估，不能宣称绝对安全 |
| 消息/房间限制 | 64 KiB WS、500 房间、1h TTL、100 MiB 单文件 | 无 IP 级频率限制和流量配额 |

### 9.2 高优先级威胁

| 威胁 | 发生条件 | 影响 | 建议优先措施 |
|---|---|---|---|
| 配对链接泄露/被截获 | 链接转发、截图、屏幕共享、访问日志 | 未经允许的第三方加入房间 | 显示 6 位双端确认码、一次性配对、敏感链接保护 |
| TURN 被滥用 | 公开服务允许大量匿名建连 | 带宽费用、服务拥塞 | IP/账号/房间限流、TURN quota、滥用告警 |
| 恶意/超大文件 | 用户同意接收未知文件 | 恶意文件风险、内存耗尽 | 文件类型提示、接收大小限制、流式处理 |
| 信令消息洪泛 | 未认证 WS 客户端高频发消息 | CPU/内存/网络消耗 | 连接与消息速率限制、反向代理保护 |
| 设备假冒 | 只验证房间 URL，不验证对方 | 文件发送给意外设备 | 二次确认配对码、身份指纹/SAS |
| 依赖/部署错误 | 版本漂移、错误证书、错误 TURN 密钥 | 无法连接或安全退化 | 锁定依赖、升级扫描、部署自动校验 |
| 后台中断 | 手机锁屏、浏览器休眠 | 传输失败 | 明确界面告知、超时/重传机制 |

### 9.3 隐私边界与数据留存

- `server.js` 不接收文件二进制主体，不在数据库/对象存储保存文件。
- 文件暂存在接收浏览器的 JS 运行内存/Blob Object URL；关闭页面后不能指望继续下载。
- 文本与文件名**在 WebRTC 通道内传递**；信令服务器仍可能处理 IP、房间号、SDP/ICE 等连接元数据。
- 网站代理、云厂商和 TURN 运营节点能观察一定的连接元数据与流量大小；不要宣传为“完全匿名/任何人都无法知道你传了什么”。
- 当前没有正式隐私政策、日志保留策略或滥用处理机制；公开上线前需补齐。

### 9.4 建议的生产强化顺序

1. **P0**：非对称网络实测；HTTPS/TURN 部署审计；避免 Node 3000 公网裸露；增加 IP 频控。
2. **P0**：双端一次性六位码或 SAS 身份校验、房间超时与传输超时、恶意流量保护。
3. **P1**：文件 SHA-256 校验、流式接收、最大会话流量/日用量配额。
4. **P1**：依赖锁文件、CI 安全扫描、最小权限服务账户、日志脱敏和告警。
5. **P2**：公开服务的隐私政策、服务条款、滥用举报、数据保留与删除规则。

---

## 10. 测试方案与验收标准

### 10.1 测试层次

- **静态/代码级**：`node --check`、代码审查、依赖版本审计。
- **HTTP/WS 协议**：静态页面、二维码、创建/加入/满房/非法 ID/过期、跨源 Origin、消息尺寸限制。
- **浏览器集成**：真实两浏览器 SDP/ICE/DataChannel 是否建立，文字和文件协议是否闭环。
- **设备 E2E**：Mac/iPhone、Windows/Android、同 Wi-Fi、不同运营商、5G、VPN/代理限制网络。
- **可靠性与安全**：断线、拒绝、文件大小上限、长时间等待、房间抢占、资源耗尽。

### 10.2 测试用例（执行后填写结果）

| ID | 场景 | 操作 | 预期 | 当前结果 |
|---|---|---|---|---|
| T01 | 首页 | `GET /` | 页面返回 200 | 待实测 |
| T02 | 基本配对 | A 创建房间，B 用链接加入 | A/B 显示已连接 | 待实测 |
| T03 | 二维码 | 手机扫描 QR | 打开同一房间 URL | 待实测 |
| T04 | 房间满员 | 第三台设备加入 | 拒绝并提示房间已满 | 待实测 |
| T05 | 无效房间 | `join` 传不存在 ID | 显示错误 | 待实测 |
| T06 | 文本互传 | A 发中文、URL、emoji | B 正确显示并可复制 | 待实测 |
| T07 | 文件同意 | A 发文件，B 点击接收 | 进入传输并生成下载链接 | 待实测 |
| T08 | 文件拒绝 | B 点击拒绝 | 发送方得到拒绝提示 | 待实测 |
| T09 | 双向文件 | A→B、B→A 各传 1 MiB | 两端均可下载正确内容 | 待实测 |
| T10 | 顺序多文件 | 连续发送 3 个文件 | 逐个发送，顺序完成 | 待实测 |
| T11 | 上限 | 尝试 101 MiB 单文件 | 本地拒绝发送 | 待实测 |
| T12 | 零字节文件 | 发送空文件 | 接收端生成可下载文件 | 待实测 |
| T13 | 断线 | 传输时关闭 B 页面 | A 给出失败/断连状态 | 待实测 |
| T14 | 房间过期 | 房间存在超过约 1 小时 | 服务端清理并关闭连接 | 待实测 |
| T15 | 跨网直连 | A Wi-Fi，B 5G | ICE 成功并可传文件 | 待实测 |
| T16 | TURN 中继 | 限制直连网络 + 正确 TURN 配置 | ICE 选择 relay 候选并可传文件 | 待实测 |
| T17 | 资源清理 | 关闭两端网页 | 房间从内存移除 | 待实测 |
| T18 | 跨源 WS | 不同源网页发起 WS | 被服务端关闭 | 待实测 |
| T19 | 下载内容一致性 | 发送已知 SHA-256 样本、下载后外部比较 | 哈希一致（**测试工具校验**，应用内尚未实现） | 待实测 |
| T20 | 手机后台 | 文件发送中锁屏/切后台 | 记录行为；不得默认承诺成功 | 待实测 |

### 10.3 浏览器/网络测试矩阵

| 设备组合 | 同 Wi-Fi | 不同 Wi-Fi | Wi-Fi ↔ 4G/5G | TURN relay 专项 |
|---|---|---|---|---|
| macOS Chrome ↔ iOS Safari | 必测 | 建议 | 必测 | 必测 |
| Windows Edge ↔ Android Chrome | 必测 | 建议 | 必测 | 必测 |
| macOS Safari ↔ Windows Chrome | 建议 | 建议 | — | 建议 |
| iOS Safari ↔ Android Chrome | 建议 | 建议 | 必测 | 建议 |

**记录模板**：测试日期、设备/OS/浏览器版本、IP 网络路径、源文件大小及 SHA-256、ICE 选择候选类型、总耗时、对端保存后的 SHA-256、是否使用 TURN、console/coturn 错误摘要。

### 10.4 验收通过条件（建议）

- 核心 T01～T09 全部成功；核心双向传输的本地文件哈希与接收后下载文件一致。
- 真实跨网场景 T15 或 T16 至少有一个可工作路径，且在配置 TURN 的封闭网络测试中 T16 可复现。
- 测试中拒绝、过期、无效房间等异常状态能被正确提示，不发生文件内容写入服务端的意外行为。
- 未处理的高风险安全问题有明确阻断上线的判断，而非仅写在“以后再做”中。

上述标准是**建议的测试验收门槛**，不是已发生的测试结果。

---

## 11. 运维、监控和故障排查

### 11.1 日常运维命令

```bash
# Node 信令服务
sudo systemctl status quickdrop --no-pager
sudo journalctl -u quickdrop -n 100 --no-pager
sudo systemctl restart quickdrop

# HTTPS 代理
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager

# TURN 中继
sudo systemctl status coturn --no-pager
sudo journalctl -u coturn -n 100 --no-pager

# 端口监听
sudo ss -tulpn | grep -E ':(80|443|3000|3478|5349)\\b'

# 仅测试网站 GET（不是 HEAD）
curl -fsS -o /dev/null -w '%{http_code}\n' https://drop.example.com/
```

### 11.2 常见问题排查表

| 问题 | 优先检查 | 处理方向 |
|---|---|---|
| 网页无法打开 | DNS、Caddy、443、证书、安全组 | 确保域名解析、公网端口与证书正确 |
| 访问 `/` 返回 200，但无法创建房间 | DevTools WS `/ws` 是否 101、Node 服务日志 | 检查 WS 升级和 Origin/Host，一致域名访问 |
| 扫码后显示房间不存在 | URL `room`、原 Node 进程是否重启、是否超 1 小时 | 重新生成新房间二维码 |
| 配对成功但 DataChannel 不通 | ICE state、WebRTC internals、TURN 日志 | 修复 TURN 凭证、NAT、公网地址、UDP 转发 |
| 同 Wi-Fi 可用，5G 失败 | `TURN_URLS`、`TURN_SECRET`、UDP 3478、relay 端口 | 先验证 coturn 监听与端口，再检查 ICE |
| HTTPS 可用，二维码链接却是 HTTP | `PUBLIC_URL` 或反向代理 Host/X-Forwarded-Proto | 显式设置 `PUBLIC_URL=https://.../` |
| 文件显示 100% 但对方未完成 | `file-ok` 尚未返回、接收浏览器内存、连接中断 | 检查 DataChannel、接收端控制台、文件大小 |
| 点击下载无反应 | 移动浏览器下载权限、Blob 内存、页面已关闭 | 用小文件复测，检查 Safari 下载行为 |
| 房间运行 1 小时被关闭 | 当前硬编码创建时 TTL | 新建房间；规划改成会话活动和传输期策略 |
| `curl -I /` 返回 405 | 当前 HTTP 只实现 GET | 改用 `curl` GET；不是服务崩溃 |
| 运行 `.env` 不生效 | `npm start` 不读取 `.env` | 用 `node --env-file=.env server.js` 或 systemd |
| systemd 启动失败 | Node 路径、权限、`EnvironmentFile`、目录 | `command -v node`，查看 `journalctl` |
| TURN 配好了却始终无法 relay | 证书/realm/密钥/端口池、公网地址、网络限制 | 按 coturn 日志逐项核对，必要时加 TURN/TLS |

### 11.3 建议增加但当前没有的观测能力

- `GET /healthz`：不依赖外部系统的存活检查。
- `GET /readyz`：反映关键配置完整性，避免直接泄漏 TURN 密钥。
- 指标：活跃 WS、活跃房间、创建失败率、信令异常、ICE 成功率（由客户端匿名汇报）、TURN 流量、CPU/RAM、出网带宽。
- 脱敏日志：生成不可追溯的短会话 ID；不记录完整配对链接、SDP 明文或文件名。
- 可回滚发布：保留上一版本文件，先暂停新连接再更新；当前无传输中断保护。

### 11.4 升级与回滚策略（建议流程）

1. 做好 `/opt/quickdrop` 配置与代码备份；**不要将 `.env` 上传到公开仓库**。
2. 在测试环境部署与运行 T01～T16 的必要子集。
3. 低峰窗口部署；由于房间只在内存，`systemctl restart quickdrop` 会中断当前传输。
4. 保存前一版 ZIP/提交号，失败时回滚代码并重启服务。
5. 上线后关注 WS 错误率、TURN 带宽、浏览器端反馈。

---

## 12. 性能、扩展性及成本分析

### 12.1 瓶颈判断

- **P2P 直连**：瓶颈主要来自双方设备、无线网络、运营商、RTT 和 WebRTC 实现，Node 信令通常不是文件数据路径瓶颈。
- **TURN 中继**：可能受 VPS 出入站带宽、端口范围、CPU/内存及云厂商流量配额限制；中继时服务端网络负载明显提高。
- **移动端内存**：接收端 `chunks[] + Blob` 增加峰值 RAM；100 MiB 文件不是 100 MiB 内存封顶。
- **信令规模**：单进程 Map 有 500 房间限制，没有 Redis、粘性会话和跨实例信令总线。

### 12.2 为什么不能保证“局域网一定最快”

同一个 Wi-Fi 并不保证 ICE 选择 host/P2P 路径；AP 隔离、VPN、浏览器策略或防火墙可能让连接走中继。要以 WebRTC 实际 selected candidate pair 作为依据，而不是以“两个设备在同一 Wi-Fi”推断真实数据路径。

### 12.3 TURN 带宽成本的计算口径

假设通过 TURN 中继发送单个大小 `S` 的文件，TURN 需要接收发送方数据并再次向接收方发出，粗略的中继网络处理量约为 `2S`（不包括加密、重传和协议开销）；**云服务商的计费可能只看出网，也可能有不同流量定义**。例如上传一个 100 MiB 文件，在不考虑重传和协议开销时，中继转发总量约 200 MiB，但实际账单必须以 VPS/云平台计费规则为准。

### 12.4 后续扩展架构建议

- 单机阶段：Node + coturn + Caddy，一台 VPS 即可内测。
- 小规模公开阶段：Node 进程限制和频控，TURN 独立监控，安全组、日志、告警、CI。
- 多实例阶段：Redis 房间/信令路由 + 粘性连接/消息总线；TURN 扩容与地域就近接入。
- 离线模式：增加文件上传服务、对象存储、签名下载链接、过期删除、鉴权和成本控制；这一模式与当前 P2P 的信任与成本模型不同。

---

## 13. 版本规划与迭代任务

### 13.1 里程碑

| 版本 | 重点 | 交付判据 |
|---|---|---|
| v1.0 MVP（当前源码） | 两人房间、网页配对、文本、文件、TURN 配置 | 代码存在；尚待真实设备测试 |
| v1.1 稳定性 | 连接超时、自动重试、明确的失败状态、基本单元/E2E 测试 | 主要失败场景可复现并提示 |
| v1.2 安全加强 | 一次性配对码/SAS、频控、TURN quota、配置信息审计 | 对端身份核对与限流可验证 |
| v1.3 大文件优化 | 接收端流式保存、内存控制、哈希、文件级超时 | 选定浏览器可稳定处理目标尺寸 |
| v2.0 高级传输 | 断点续传、恢复协议、批量任务队列、传输统计 | 中断恢复与可观测性测试通过 |
| v2.x 可选云端 | 离线收件箱、过期存储、用户授权 | 有明确隐私、存储费用与删除策略 |

### 13.2 推荐任务优先级

**P0：必须先解决**

- 在至少两组手机/电脑组合做真实局域网、5G、TURN 三种场景测试。
- 为文件传输的“等待接收确认”“等待完成确认”“ICE 协商”增加超时与失败恢复。
- 解决 WS 断线后的自动恢复与房间重建体验。
- 增加设备身份核对短码与最基本的房间创建/消息限流。
- 加入自动化协议/浏览器测试；提交 `package-lock.json` 便于可重复部署。

**P1：质量与性能**

- 使用流式落盘方案，按浏览器能力降级；避免一次性将大文件全部保存在内存。
- 为每个文件生成/验证 SHA-256；显示“已下载保存”和“仅已接收”之间区别。
- 记录准确传输速率、耗时、候选类型，调整分块与缓存水位。
- 增加更完整的 Caddy/coturn systemd 部署自动校验脚本。

**P2：产品扩展**

- 多文件任务队列、进度列表、移动端友好的文件保存引导。
- PWA 安装入口（注意 PWA 不等于保证后台传输）。
- 断点续传、可选设备配对记录、本地加密文件预览。
- 可选云端离线传输与可配置保存期限。

---

## 14. 交付清单与上线检查表

### 14.1 当前交付物

| 类别 | 文件/位置 |
|---|---|
| 源代码 | `server.js`、`public/index.html`、`public/app.js`、`public/style.css` |
| 构建运行 | `package.json`、`.env.example`、`.gitignore` |
| 部署模板 | `deploy/Caddyfile`、`deploy/turnserver.conf`、`deploy/quickdrop.service` |
| 原始说明 | `README.md` |
| 本项目完整文档 | `docs/QuickDrop-完整项目文档.md`（在文档增强版 ZIP 中） |

### 14.2 上线前 Checklist

- [ ] HTTPS 证书有效，域名解析正确；WSS 可升级，`/ws` 能连接。
- [ ] 服务器 `PORT` 不暴露给公网；SSH 端口受控。
- [ ] `.env` 使用真实私有 TURN 密钥且文件权限受限，密钥不在 Git/日志中。
- [ ] coturn 使用正确公网地址、开放中继端口，并能在 5G/限制网络中实际 relay。
- [ ] 两端配对与文件收发经过真实设备验收，且下载后文件哈希一致。
- [ ] 房间过期、拒绝、不存在、第三设备、断线等错误均有可理解提示。
- [ ] 公网部署前补足必要的频控、反滥用策略和设备身份校验。
- [ ] TURN 带宽/费用有上限与告警方案。
- [ ] 确认日志不记录配对链接、明文 SDP、文件内容或敏感内容。
- [ ] 明确告知用户“没有离线存储”“没有断点续传”“对方需在线”。
- [ ] 有备份、升级和回滚计划；服务重启影响现有传输的风险已披露。

---

## 15. 术语表与参考链接

### 15.1 术语

| 术语 | 解释 |
|---|---|
| P2P | Peer-to-Peer，设备间点对点数据通信 |
| WebRTC | 浏览器实时通信能力集，用于协商连接与传输数据 |
| DataChannel | WebRTC 中的任意数据通道；本项目用于文字与文件 |
| WebSocket | 浏览器和信令服务器间的持续双向连接 |
| SDP | Session Description Protocol，描述连接能力，用于 Offer/Answer |
| ICE | Interactive Connectivity Establishment，收集和检查候选连接路径 |
| STUN | 协助识别 NAT 外部可见地址，不负责转发文件 |
| TURN | 直连失败时转发 WebRTC 数据的中继服务 |
| NAT | 网络地址转换，跨网络直连常见阻碍之一 |
| WSS | 通过 TLS 加密的 WebSocket |
| DTLS | WebRTC 数据通道使用的传输安全机制 |
| Blob | 浏览器表示二进制大对象的 API；本项目用于创建下载链接 |
| TTL | Time to Live，房间存活时长 |
| SAS | Short Authentication String，双端核对的短校验码，当前未实现 |

### 15.2 官方资料

- MDN — Using WebRTC data channels：<https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels>
- MDN — `RTCDataChannel`：<https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel>
- MDN — `bufferedAmountLowThreshold`：<https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold>
- MDN — `RTCPeerConnection`：<https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection>
- Caddy — `reverse_proxy`：<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>
- coturn — GitHub：<https://github.com/coturn/coturn>
- coturn — `turnserver` 手册：<https://github.com/coturn/coturn/blob/master/man/man1/turnserver.1>
- `ws`（Node.js）— npm：<https://www.npmjs.com/package/ws>
- Node.js — CLI `--env-file`：<https://nodejs.org/api/cli.html#--env-filefile>

### 15.3 文档结论

当前 QuickDrop 是一套结构清晰、适合继续迭代的**匿名双设备网页互传原型**。核心路径为“WebSocket 建房间与交换信令 → ICE 建立连接 → WebRTC DataChannel 加密发送文件/文字 → 必要时 TURN 中继”。它适合私人实验、小规模内测与学习 WebRTC，但若准备开放公众使用，必须补齐真实设备验收、设备身份核对、限流、监控、超时恢复、大文件处理和运维安全措施。

---

*文档结束。文档只描述当前给定的 QuickDrop MVP 源码和建议演进，不代表功能已经通过实际多平台测试。*
