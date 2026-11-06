# 发布安装包

GitHub Actions 的 [Release installers](https://github.com/yzbcs/NEU-Dela/actions/workflows/release.yml) 工作流负责 Apple Silicon Mac 和 Windows x64 安装包。

## 发版

1. 更新 `package.json`、`package-lock.json` 中的版本号，以及 README、更新记录中的版本说明与下载链接。
2. 将发布说明保存为 `docs/releases/v版本号.md`，提交并推送源码。
3. 给这次提交打上与版本号相同的 `v` 标签，再推送该标签。比如版本号为 `0.7.2` 时：

```sh
git tag v0.7.2
git push origin v0.7.2
```

工作流先确认标签与 `package.json` 版本一致、发布说明存在。然后在 `macos-15` 的 arm64 环境和 `windows-2022` 的 x64 环境分别安装锁定依赖、运行测试、生产构建与打包，并实际启动打包后的应用，检查设置、本地资料和重启恢复。桌面检查使用隔离的人工数据与本机模拟服务，无需配置真实模型或邮箱凭据。

两个系统全部通过后，安装包先上传到 Release 草稿，上传成功才公开。普通版本设为最新版；带预发布后缀的版本标记为 Pre-release，不替换最新版。已公开版本不会覆盖，修正后应使用新版本号。上传失败留下的草稿可通过 GitHub 的 Re-run failed jobs 继续完成。

两端安装包目前未签名，macOS 未公证。托管 Windows 环境的自动桌面检查与个人电脑上的安装、系统通知和日常使用验证分别记录。

## 只试跑，不发布

在 Actions 中选择 **Release installers → Run workflow**，选择需要验证的分支。或在本机运行：

```sh
gh workflow run release.yml --repo yzbcs/NEU-Dela --ref main
```

手动运行会执行同样的构建、打包和桌面检查，将结果保存在该次运行的 Artifacts，**不会创建或修改 Release**，也不需要改版本号。

- `installer-mac-arm64`：Mac DMG。
- `installer-win-x64`：Windows NSIS 安装包。
- `desktop-reports-mac-arm64`、`desktop-reports-win-x64`：两平台桌面报告、人工数据截图和失败详情。

这些临时产物保留七天。正式 Release 的下载附件不受这个期限影响。检查失败时先看对应步骤日志及桌面报告，修复原因后再运行；无需在本机重复生成两端安装包。

常规 [CI](https://github.com/yzbcs/NEU-Dela/actions/workflows/ci.yml) 继续处理 main 提交与 Pull Request 的 Linux 测试和生产构建。Release 工作流独立检查要发布的具体提交，因此不会把另一条提交上的 CI 结果当作本次发版结果。

## 已执行的验证

2026-11-07，[手动试跑 42305547881](https://github.com/yzbcs/NEU-Dela/actions/runs/42305547881) 在提交 `b136292` 上通过。Mac arm64 与 Windows x64 各通过 163 项测试、生产构建、安装包生成，以及最终应用的 10 项设置检查、13 项本地资料检查和两组重启恢复。两个安装包及桌面报告均已上传到该次运行的 Artifacts。

首次 Windows 试跑暴露了检查脚本把窗口外框尺寸当作页面尺寸的问题。脚本已统一使用 1024×700 的内容区域，保留正文至少 250px 的要求；实际 Mac 正文高度为 284px，Windows 为 290px。

本次只验证构建与打包后运行，没有创建新版本或改动现有 0.7.1 Release；自动上传并公开 Release 的步骤将在下一次新版本标签发布时执行。个人电脑上的 Windows 安装、系统通知和日常使用仍需单独验证。
