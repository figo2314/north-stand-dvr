# 北看台

一个本地优先、默认隐藏比分和赛果的足球录像台。它为凌晨比赛准备：服务在后台按计划调用 FFmpeg 录制，浏览器端只展示球队、时间和录像长度，不会把未揭晓比分放进标题、缩略图、标签页或接口响应。

## 快速开始

```powershell
npm install
npm start
```

然后打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。

手机需要与电脑处于同一局域网时，使用局域网模式启动：

```powershell
npm run start:lan
```

随后通过电脑的局域网 IPv4 地址访问，例如
`http://192.168.50.62:4173/channels.html`。如果 Windows 防火墙弹出提示，
需要允许 Node.js 访问专用网络。

程序使用 `data/db.json` 作为本机录像库。当前库中没有 DEMO 数据，真实录制的比赛会直接出现在“待看录像”里。

## 比赛雷达

打开 [http://127.0.0.1:4173/mockup.html](http://127.0.0.1:4173/mockup.html)，程序会读取当前 M3U 的体育分组，按开球时间排列比赛。即将开始或正在直播的比赛可以一键预录，流地址会直接写入录制日程；再次点击即可取消尚未开始的预约。已结束的条目可以直接“录制回放”，该流程不受开球时间窗口限制，录制完成后会进入待看录像。

## 电视直播

打开 [http://127.0.0.1:4173/channels.html](http://127.0.0.1:4173/channels.html)，可以播放多个 M3U 中除体育分组外的频道。页面支持搜索、分组筛选、收藏、最近播放、智能排序、可播性预检、XMLTV 节目单、画质切换、实时速度与缓冲显示、暂停、画质选择、画中画、投屏和全屏。

## 足球直播

打开 [http://127.0.0.1:4173/football.html](http://127.0.0.1:4173/football.html)，可以集中查看 M3U 中的体育分组和足球赛事频道。页面复用电视直播播放器，并支持球队、赛事和解说搜索。

直播源在“遮罩与设置”中集中管理。每条源可以设置显示名称、M3U 地址、备用地址、启用状态和优先级。服务端会合并重复频道，并把首帧延迟、分辨率、成功和失败次数保存在 `data/db.json` 中，用于智能选线和离线沉底。

应用提供 Web App Manifest 与 Service Worker，可从手机浏览器安装到桌面，并缓存应用外壳。播放页在受支持的浏览器中会接入锁屏媒体控制、屏幕常亮、画中画和远程播放。

## Apple TV 与 IPTV 播放器

设置页会生成只读电视令牌，以及可供 Apple TV IPTV 播放器使用的地址：

- M3U 订阅：`/api/tv/playlist.m3u?token=...`
- XMLTV 节目单：`/api/tv/epg.xml?token=...`
- HLS 流代理：`/api/tv/stream/:channelId?token=...`

播放列表中的频道地址全部指向本服务，原始直播源和鉴权参数不会暴露给播放器。令牌只能读取电视内容，可随时在设置页重新生成。

## 首发阵容

比赛日程和比赛雷达中的“首发阵容”按钮会打开独立阵型页。服务会先通过 TheSportsDB 免费源匹配球队和比赛，再使用 API-Football 查询阵容；免费数据不完整时可在页面底部手动粘贴双方首发补全。

可选环境变量：

```text
FOOTBALL_API_PROVIDER=auto
FOOTBALL_API_KEY=...
FOOTBALL_API_BASE=https://v3.football.api-sports.io
```

API-Football 免费套餐通常只允许历史赛季；TheSportsDB 免费源可以匹配当前赛程，但完整官方首发仍以数据源实际返回内容为准。

## Linux VM 使用主机 FFmpeg

如果 VPS 主机已经安装 FFmpeg，但容器内的静态二进制不稳定，可以使用 VM override：

```bash
docker compose -f compose.yaml -f compose.vm.yaml up -d
```

该配置通过 `deploy/ffmpeg-host.sh` 调用主机 FFmpeg，并只读挂载所需的动态库。适用于 Ubuntu 24.04 等 glibc 2.39 主机。

### 多用户访问控制

VM 部署可以通过 `.env` 启用 HTTP Basic Auth，支持多个用户：

```bash
APP_BASIC_USERS=football:<hash1>,heiwa:<hash2>
APP_BASIC_REALM=North Stand DVR
```

生成密码哈希：

```bash
node -e "const {hashPassword}=require('./server/auth'); console.log(hashPassword(process.argv[1], process.argv[2]))" '密码' '用户名'
```

`/api/health` 始终允许匿名访问，便于容器健康检查；其余页面和接口都会受到保护。

## 实际录制

1. 在“录制日程”中添加球队、开球时间和直播流地址。
2. 可以直接填写频道地址，也可以填写 M3U 地址后加载频道并搜索球队名称。
3. 对没有 `.m3u8` 后缀的 HLS 网关，把“流格式”设为“强制 HLS”，并先点“测试流”。
4. 确认“遮罩与设置”里选的是播放器遮罩，还是直接把黑色区域写入录像文件。
5. 保持 `npm start` 服务运行，电脑不要休眠。
6. 服务会在开球前缓冲时间自动启动 FFmpeg，并在比赛结束后延录窗口到时停止。
7. 第二天打开网页，点击“直接播放”即可。

直播流地址由用户自行提供。HLS、直链 MP4 等能否直接录制取决于来源、鉴权方式和编码，程序不会绕过平台的访问控制。

## 无剧透机制

- 未揭晓时，服务端会移除 `/api/state` 中的比分字段，前端无法意外拿到赛果。
- 录像标题和缩略图默认不包含比分。
- 播放器可以在画面左上、中上、右上或左下放置可调比分遮罩。
- “揭晓比分”只会在用户确认后把赛果保存在本机。
- 浏览器标签页固定为“北看台”，不会在切窗口时暴露球队或结果。

## 数据与目录

- 应用数据：`data/db.json`
- 默认录像目录：`recordings/`
- 临时文件：`data/db.json.tmp`

录像目录可以在设置页修改。扫描功能会递归查找 `.mp4`、`.mkv`、`.mov`、`.ts`、`.m4v` 和 `.webm` 文件。

## 测试

```powershell
npm test
```
