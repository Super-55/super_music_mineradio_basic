# Mineradio

![Mineradio 暗场启动页](./docs/assets/readme/cinema-beat-smoke.png)

Mineradio 是一款 Windows 桌面沉浸式音乐播放器，把在线音乐、本地音乐、播客、歌词舞台、粒子视觉、3D 歌单架和完整桌面模式组合成更接近现场感的私人音乐空间。当前仓库是由 `Super` 在原 Mineradio 项目基础上持续改造和维护的酷狗概念版专属版本。

## 下载 super_mineradio_s

| 内容 | 链接 |
| --- | --- |
| GitHub Release | [super_mineradio_s v1.0.0](https://github.com/Super-55/super_music_mineradio_basic/releases/tag/v1.0.0) |
| Windows x64 安装包 | [下载 super_mineradio_s.exe](https://github.com/Super-55/super_music_mineradio_basic/releases/download/v1.0.0/super_mineradio_s.exe) |
| SHA-256 校验文件 | [下载 super_mineradio_s.exe.sha256](https://github.com/Super-55/super_music_mineradio_basic/releases/download/v1.0.0/super_mineradio_s.exe.sha256) |

正式安装请使用 `super_mineradio_s.exe`，不要把 `.blockmap`、`latest.yml` 或 `win-unpacked` 当作安装包。

## 当前版本

- 应用内部版本：`2.0.2`
- Super 定制发行标签：`v1.0.0`
- 内部应用名：`Mineradio`

`2.0.2` 用于应用和安装升级识别；`v1.0.0` 是 `super_mineradio_s` 定制发行系列的首个 GitHub Release。

## 改造与维护

这个版本不是简单更换名称或界面。围绕账号协议、服务端路由、播放状态机、歌词时序、缓存策略、Electron 安全边界和 Windows 发行流程进行了持续调整与验证。

### 在线音乐架构与账号

- 将在线音乐架构收敛为酷狗概念版唯一在线音乐来源，删除网易云、QQ、汽水和 Spotify 的在线搜索、播放及自动换源链路
- 保留本地音乐/MP3 导入和播客，使本地内容与长音频能力不受在线音源收敛影响
- 修复酷狗概念版二维码登录、登录状态恢复、VIP 状态、账号资料、远程歌单和歌单歌曲获取
- 参考酷狗概念版协议完善播放地址、会员权限和音质请求，登录令牌只由 Electron 主进程管理并使用 Windows 安全存储保护

### 播放、音质与歌词

- 为受限歌曲、无可用播放地址和切歌失败增加队列跳过与防卡死处理，不再循环请求已删除的平台
- 改进无损音质请求、实际音质识别和降级提示，让请求音质与最终播放结果更透明
- 接入酷狗原文歌词与译文，增加磁盘缓存和下一首歌词预取
- 将原文和译文改为分阶段并行加载：原文先显示，译文随后合并
- 普通酷狗在线播放会在开始前等待原文歌词，最长 800ms；缓存命中立即继续，译文不阻塞播放

### 界面与发行工程

- 调整首页模块比例和整体容器滚动，让滚轮控制完整主页而不是局部模块
- 修复源码启动快捷方式、官方图标注入和 Windows 图标缓存问题
- 建立 `super_mineradio_s.exe` Windows NSIS 构建、SHA-256 校验和 GitHub Release 流程
- 增加发行内容脱敏审计，阻止登录状态、Cookie、令牌、缓存、本机用户名和绝对路径进入安装包

## 当前核心能力

- 酷狗概念版在线搜索、播放、账号登录、VIP 状态、远程歌单、收藏和播放队列
- 本地音乐/MP3 导入与自定义专辑封面
- 播客、长音频和 DJ 曲目专属视觉模式
- 原文歌词、歌词译文、自定义歌词、歌词位置与视觉控制
- 完整桌面模式、首页、播放器、队列和桌面交互
- 粒子舞台、歌词舞台、基于节奏的电影镜头视觉系统和 3D 歌单架
- 本地 MP4 与 Wallpaper Engine 视觉内容
- GitHub Releases 更新检测与下载入口

## 安装与运行

Windows 用户可从上面的 GitHub Release 下载并运行 `super_mineradio_s.exe`。安装器会创建 `Mineradio` 桌面快捷方式，内部应用身份保持不变，可继续兼容现有安装和用户数据目录。

校验安装包：

```powershell
(Get-FileHash .\super_mineradio_s.exe -Algorithm SHA256).Hash
```

`v1.0.0` 安装包 SHA-256：

```text
8176a813e579964271209e81c38bf49a103bbed5b8db2823a0e72e0da45dcbc4
```

开发运行：

```bash
npm install
npm start
npm run build:win
```

桌面版由 Electron 主进程加载本地服务，`npm run build:win` 生成 Windows NSIS 安装包。

## 第三方音乐平台说明

Mineradio 不是酷狗音乐、腾讯音乐娱乐集团或其他音乐平台的官方客户端，也不隶属于任何音乐平台。酷狗概念版接入基于社区接口研究，不是酷狗官方公开 API。

项目中的第三方平台接入仅用于个人学习、本地客户端体验和用户自有账号的播放辅助。请遵守对应平台的用户协议、版权规则和会员权益规则。项目不会提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

## 用户数据与隐私

登录状态、搜索历史、自定义封面、自定义歌词和节奏分析缓存等数据只应保存在本机用户数据目录中，不应提交到仓库或打包进发行版。发行构建会检查 Cookie、令牌、缓存、本机用户名和绝对路径等敏感内容。

更多说明见 [PRIVACY.md](./PRIVACY.md)。

## 致谢与维护关系

Mineradio 原始项目由 XxHuberrr 主要设计与打造。emily 是早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一。

当前仓库中的酷狗概念版专属架构、账号与歌单接入、播放和歌词稳定性、界面调整、Windows 快捷方式修复、脱敏构建及 GitHub 发行工作由 `Super` 持续改造和维护。

## 版权与授权

原项目版权信息：Copyright (C) 2026 XxHuberrr.

本仓库的新增修改由相应贡献者保留其版权，并继续采用 GPL-3.0 授权。详见 [LICENSE](./LICENSE)。

MR Logo、Mineradio 名称、原始界面视觉设计与原创视觉表达归其原作者所有；第三方依赖和第三方服务分别遵循其各自授权与服务条款。
