# 发布安装包

GitHub Actions 的 [Release installers](https://github.com/yzbcs/NEU-Dot/actions/workflows/release.yml) 工作流负责 Apple Silicon Mac 和 Windows x64 安装包。

## 发版

1. 更新 `package.json`、`package-lock.json`、README 和更新记录中的版本号。
2. 将发布说明保存为 `docs/releases/v版本号.md`，提交并推送源码。
3. 给这次提交打上与版本号相同的 `v` 标签，再推送该标签。例如版本号为 `0.7.2` 时使用以下命令。

```sh
git tag v0.7.2
git push origin v0.7.2
```

也可以用首行为 `release: v0.7.2` 的提交更新 `docs/releases/v0.7.2.md` 并推送到 `main`。两端打包成功后，工作流会为该提交创建发布标签。任选一种方式发版即可。

工作流核对版本号和发布说明，然后在 `macos-15` 的 arm64 环境和 `windows-2022` 的 x64 环境分别安装锁定依赖、检查类型、运行生产构建并打包。

两个系统全部通过后，工作流合并安装包与更新清单，使用 `scripts/verify-release-updates.mjs` 核对版本、文件大小、SHA-512 和 Windows blockmap。全部产物先上传到 Release 草稿，上传成功才公开。普通版本设为最新版；带预发布后缀的版本标记为 Pre-release，不替换最新版。已公开版本不会覆盖，修正后应使用新版本号。上传失败留下的草稿可通过 GitHub 的 Re-run failed jobs 继续完成。

两端安装包目前未签名，macOS 未公证。

## 应用内更新与发布产物

更新源为公开 GitHub 仓库 `yzbcs/NEU-Dot` 的稳定版 Release。客户端使用打包时生成的 `app-update.yml` 读取更新源，启动约 10 秒及每 6 小时检查。用户主动下载，再点击重启安装。客户端关闭预发布及降级，Windows 关闭自动退出安装与 Web Installer。

每次稳定版需要同时发布以下文件，其中 `${version}` 替换为实际版本号。

| 文件 | 用途 |
| --- | --- |
| `NEU-Dot-${version}-mac-arm64.dmg` | Mac 首次安装 |
| `NEU-Dot-${version}-mac-arm64.zip` | Mac 应用内升级 |
| `NEU-Dot-${version}-win-x64.exe` | Windows 首次安装及 NSIS 升级 |
| `latest-mac.yml`、`latest.yml` | 版本、产物名、大小与 SHA-512 |
| `*.blockmap` | Windows 差分下载及打包器生成的 Mac 校验产物 |

Windows 使用 `electron-updater` 的 NSIS 更新器。Mac 使用 `MacZipUpdater` 复用版本检查、下载缓存及 SHA-512 校验，另由 `mac-update-helper.sh` 负责应用替换，适配当前未签名分发。安装前重新校验 ZIP、应用标识、版本、可执行入口及符号链接范围，将新应用预解包到同卷目录。应用退出后保留旧包并替换，新进程在 45 秒内打开对应工作台后确认成功，启动失败时恢复旧包及其原可执行文件。安装日志保存在数据目录的 `updates/install.log`。

更新信任 GitHub 发布权限与 HTTPS 传输，SHA-512 检查下载文件是否匹配发布清单。当前方案没有独立的开发者签名验证，仓库发布权限失陷仍可能导致恶意更新。Mac 流程保持系统原有的安全检查和应用目录权限要求。

旧版没有更新模块，需要先手动安装一次包含此功能的新版本。此后更高版本才能通过应用内升级。此功能的本地升级验证使用隔离的模拟发布源，GitHub 正式分发及 Windows 实机升级应在发版前继续验证。

## 只试跑，不发布

在 Actions 中选择 **Release installers → Run workflow**，选择需要验证的分支。或在本机运行：

```sh
gh workflow run release.yml --repo yzbcs/NEU-Dot --ref main
```

手动运行会执行构建和打包，将两个安装包保存在该次运行的 Artifacts。

- `installer-mac-arm64` 包含 Mac DMG、ZIP、blockmap 与 `latest-mac.yml`。
- `installer-win-x64` 包含 Windows NSIS 安装包、blockmap 与 `latest.yml`。

临时产物保留七天。正式安装包可在 Releases 下载。常规 [CI](https://github.com/yzbcs/NEU-Dot/actions/workflows/ci.yml) 在 Linux 上对 `main` 和 Pull Request 执行类型检查与生产构建。
