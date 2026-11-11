# 参与开发

欢迎通过 [Issues](https://github.com/yzbcs/NEU-Dot/issues) 反馈实际使用问题或提出具体场景，也可以提交 Pull Request。

## 本地启动

使用 `.node-version` 指定的 Node.js 版本：

```sh
npm ci
npm run dev
```

## 代码位置

| 路径                  | 用途                                                       |
| --------------------- | ---------------------------------------------------------- |
| `src/main/`           | Electron 主进程、AI 协议、工作台存储、邮件、通知、课表解析 |
| `src/preload/`        | 主进程与界面之间的 IPC 接口                                |
| `src/renderer/`       | React 界面与样式                                           |
| `src/shared/`         | 类型、校验、搜索、日程与主题                               |
| `website/`            | 官网与功能演示                                             |
| `scripts/`            | 官网构建入口                                               |
| `docs/`               | 使用与发布说明                                             |
| `assets/screenshots/` | 使用人工数据制作的公开截图                                 |

构建结果在 `out/`，安装包在 `assets/output/releases/`。请将本地测试数据、日志和生成结果放在 `.gitignore` 中列出的目录。

## 修改与验证

请说明具体问题、修改后的行为和相关验证。普通修复沿用现有数据结构与保存入口，避免为单一需求增加不必要的抽象。

```sh
npm run build
```

界面或桌面流程修改可以通过 `npm run dev` 打开应用复现。CI 在 Linux 检查类型并运行生产构建，Release 工作流在 Mac 和 Windows 分别打包。打包步骤见[发布指南](docs/releasing.md)。

格式化只运行在本次修改的文件上，例如：

```sh
npx prettier --write src/renderer/DashboardPage.tsx
```

反馈课表或邮箱问题时，提供能复现的脱敏样例与版本/系统信息。不要上传学校密码、模型密钥、邮箱授权码或完整个人数据目录。
