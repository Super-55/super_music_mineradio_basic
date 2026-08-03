# super_mineradio_s Windows 发行设计

## 目标

为当前酷狗概念版专属的 Mineradio 代码生成可安装的 Windows x64 发行版，恢复桌面快捷方式上的 Mineradio 官方图标，并将脱敏后的发行产物发布到 `Super-55/super_music_mineradio_basic` 的 GitHub Release。

## 命名与版本

- 应用内部身份继续使用 `Mineradio`。
- `appId` 继续使用 `com.mineradio.desktop`，保持安装、升级和用户数据目录兼容。
- `package.json` 应用版本由 `2.0.1` 升为 `2.0.2`。
- 安装包文件名固定为 `super_mineradio_s.exe`。
- GitHub Release 标题为 `super_mineradio_s`。
- GitHub Release 标签为 `v1.0.0`。
- `2.0.2` 是应用内部版本；`v1.0.0` 是本定制发行系列的首个 GitHub Release 标签，二者有意独立。

## 图标修复

现有 `build/icon.ico` 是有效的 Windows ICO 文件，包含 16、24、32、48、64、128 和 256 像素的 32 位图层。现有源码快捷方式的目标与图标路径也都存在，因此资源丢失不是根因；问题位于 Windows Shell 对快捷方式图标的缓存或快捷方式元数据刷新。

发行构建继续通过 `build/after-pack.js` 使用 `rcedit` 把 `build/icon.ico` 注入 `Mineradio.exe`。构建后必须验证可执行文件能够提取出非空图标。桌面上的 `Mineradio 源码版.lnk` 将被删除后重新创建，继续以 Electron 可执行文件为目标、项目目录为工作目录，并显式使用 `build/icon.ico`。重建后调用 Windows Shell 图标刷新机制，使 Explorer 丢弃旧的空白缓存。

NSIS 安装器创建的 `Mineradio` 桌面快捷方式继续指向安装后的 `Mineradio.exe`，因此它使用经过验证的嵌入式官方图标。

## 构建与脱敏

构建使用 electron-builder 的 Windows NSIS x64 流程。打包文件继续由 `package.json` 中的白名单控制，不复制 Electron `userData`、项目根目录 Cookie 文件或构建目录之外的本机状态。

发行前检查：

1. 检查 Git 跟踪文件和拟提交差异，不包含个人账号、Cookie、令牌、登录会话、邮箱、本机用户名或用户专属绝对路径。
2. 构建后检查 `win-unpacked/resources/app` 的全部文件名，禁止 `.env`、Cookie、token、credentials、session、`Local State`、`Network`、`Partitions`、缓存和日志文件。
3. 对发行目录中的文本资源扫描 `xrc`、`C:\Users\xrc`、`D:\MyApps` 以及常见凭证字段；公开的酷狗客户端协议常量不视为用户个人凭证，但用户会话值必须为零。
4. 不把本机 Electron 用户数据、歌词缓存、账号状态或桌面快捷方式写入安装包。
5. Release 说明不包含本机路径、Git 凭证或登录信息。

## 验证

- 对所有本次修改的 JavaScript 文件运行 `node --check`。
- 运行现有 `npm test` 测试集。
- 运行 `npm run build:win`，要求 NSIS 构建成功。
- 验证 `dist/super_mineradio_s.exe` 存在且非空。
- 从 `dist/win-unpacked/Mineradio.exe` 提取并验证应用图标。
- 完成发行目录文件名与文本内容脱敏扫描。
- 生成 `super_mineradio_s.exe.sha256`，内容使用 SHA-256。
- 重新读取桌面快捷方式，验证目标、工作目录和图标路径准确。

实际安装、登录和播放体验测试由用户完成；发布前的代码、构建、图标和脱敏逻辑验证由 Codex 完成。

## GitHub 发布

只提交本轮确认范围内的源码、构建配置和设计/计划文档，不提交 `dist` 目录或本机状态。提交后把当前功能分支快进同步到现有 GitHub 仓库，创建标签 `v1.0.0` 与 Release `super_mineradio_s`，上传：

- `super_mineradio_s.exe`
- `super_mineradio_s.exe.sha256`

当前电脑没有 GitHub CLI，而已连接的 GitHub 工具不支持上传 Release 二进制。实施阶段需要先安装并认证 GitHub CLI；若现有 Git 凭据不能复用，则暂停并由用户完成一次 `gh auth login`，不会读取或输出访问令牌。

## 失败处理

- 图标注入或图标提取验证失败：停止发布，保留构建日志并修复后重新构建。
- 脱敏扫描发现个人数据：停止发布，移除源数据并从干净输出目录重新构建。
- 标签 `v1.0.0` 已存在：停止发布，不覆盖标签，由用户决定新标签。
- GitHub 推送或 Release 上传失败：不强推、不覆盖已有资产，保留本地安装包和校验文件后报告阻塞点。
