# 发布安装包

GitHub Actions 的 [Release installers](https://github.com/yzbcs/NEU-Dela/actions/workflows/release.yml) 工作流负责 Apple Silicon Mac 和 Windows x64 安装包。

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

两个系统全部通过后，安装包先上传到 Release 草稿，上传成功才公开。普通版本设为最新版；带预发布后缀的版本标记为 Pre-release，不替换最新版。已公开版本不会覆盖，修正后应使用新版本号。上传失败留下的草稿可通过 GitHub 的 Re-run failed jobs 继续完成。

两端安装包目前未签名，macOS 未公证。

## 只试跑，不发布

在 Actions 中选择 **Release installers → Run workflow**，选择需要验证的分支。或在本机运行：

```sh
gh workflow run release.yml --repo yzbcs/NEU-Dela --ref main
```

手动运行会执行构建和打包，将两个安装包保存在该次运行的 Artifacts。

- `installer-mac-arm64`：Mac DMG。
- `installer-win-x64`：Windows NSIS 安装包。

临时产物保留七天。正式安装包可在 Releases 下载。常规 [CI](https://github.com/yzbcs/NEU-Dela/actions/workflows/ci.yml) 在 Linux 上对 `main` 和 Pull Request 执行类型检查与生产构建。
