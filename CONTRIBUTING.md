# 参与开发

欢迎通过 [Issues](https://github.com/yzbcs/NEU-Dela/issues) 反馈实际使用问题或提出具体场景，也可以提交 Pull Request。

## 本地启动

使用 `.node-version` 指定的 Node.js 版本：

```sh
npm ci
npm run dev
```

`npm run demo` 使用本机模拟模型与独立数据目录，无需真实 API Key。邮件测试使用本机 IMAP/SMTP 服务，需要 PATH 中有 OpenSSL；不会向外部地址发信。

## 代码位置

| 路径                  | 用途                                                       |
| --------------------- | ---------------------------------------------------------- |
| `src/main/`           | Electron 主进程、AI 协议、工作台存储、邮件、通知、课表解析 |
| `src/preload/`        | 主进程与界面之间的 IPC 接口                                |
| `src/renderer/`       | React 界面与样式                                           |
| `src/shared/`         | 类型、校验、搜索、日程与主题                               |
| `scripts/`            | 人工夹具、演示启动、桌面验证入口                           |
| `tests/`              | 单元与本机 HTTP/邮件集成测试                               |
| `docs/`               | 使用指南、设计与调研依据                                   |
| `assets/screenshots/` | 使用人工数据制作的公开截图                                 |

构建结果在 `out/`；演示数据、测试产物和安装包在 `assets/output/`。这些目录、个人输入与日志不提交到 Git。

## 修改与验证

请说明具体问题、修改后的行为和相关验证。普通修复沿用现有数据结构与保存入口，避免为单一需求增加不必要的抽象。

```sh
npm test
npm run build
```

界面或桌面流程修改按影响范围运行 `npm run smoke:design`、`npm run smoke:actions` 或 `npm run smoke`。这些命令会启动真实 Electron 窗口，使用隔离人工数据；不要求所有改动都重跑全部桌面流程。常规 CI 在 Linux 执行依赖安装、单元/本机协议测试和生产构建。Release 工作流在 Mac 和 Windows 分别打包，并运行设置、本地资料与重启恢复检查；发布和手动试跑的步骤见[发布指南](docs/releasing.md)。

格式化只运行在本次修改的文件上，例如：

```sh
npx prettier --write src/renderer/DashboardPage.tsx
```

反馈课表或邮箱问题时，提供能复现的脱敏样例与版本/系统信息。不要上传学校密码、模型密钥、邮箱授权码或完整个人数据目录。
