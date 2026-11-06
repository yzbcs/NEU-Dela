# NEU-Dela：个人助手的界面与动效设计（0.3.8–0.4.0）

0.4.0 增加 AI 创建结果卡、品牌启动状态、通知定位与待办推迟。123 项测试通过，开发版和最终 Mac 包各通过 11 项桌面检查（含重启恢复），产出 6 张截图；两端安装包已交付，本机已更新并打开。使用方法见 [使用指南](usage.md)，版本变化见 [更新记录](../CHANGELOG.md)。

名称更新（0.3.9）：用户确定正式名称为 **NEU-Dela**，界面字标去掉尾点，默认 22px、窄窗口 20px，完整显示新名称；保留 D 折页图标与本轮视觉方向。界面、助手、窗口、托盘、通知、导入工具栏和安装包统一使用新名，本机已更新并打开。以下生成提示词保留 0.3.8 设计时的历史名称。

2026-11-07。用户选定方向：**清爽温暖，纸感底色、蓝绿点缀、轻柔动效**。

## 产品判断

个人助手的首页应先回答“接下来做什么”。0.3.7 的功能已经互通，但大统计卡、七天日程和重复的今日课程抢占同一层级。邮箱账号数和笔记总数有入口价值，优先级低于下一门课、下一件待办。

这轮把界面整理为：

1. **接下来**：今天正在进行的课程优先；没有当前课程时，展示未来七天最近的课程或定时待办。直接打开对应记录。未设置学期时显示导入引导，不能解释成没有课程。
2. **紧凑概览**：保留待办、今日课程、笔记、邮箱的真实数量和跳转，缩小卡片高度。
3. **安排与行动**：宽窗口中，唯一的七天课程时间线和可以直接完成、恢复的待办并排；窄窗口按顺序堆叠。课程时间线保留课程色标、待上课、上课中和已结束状态。
4. **继续记录**：最近笔记和常用入口放在下方；不再重复整张今日课程表。

聊天空白页改用“安排今天、整理课程笔记、查找学习资料”三个具体场景。未配置模型时先展示连接入口；点击场景只准备草稿并开启工作台读取，用户发送后才请求模型。保留编辑草稿的机会。

## 0.4.0：明确请求与真实保存结果

聊天支持创建待办、追加课程和保存笔记。用户明确说“帮我添加”“加入课表”“保存成笔记”，且必要信息完整时直接执行；缺少必要信息先追问。一般建议和拟定方案不自动保存。聊天中的“工作台已连接”说明同时包含读取与按指令创建，关闭后不提供这些工具。

保存结果以独立卡片显示在对应助手消息中。卡片内容来自本机执行回执：记录类型、标题、具体安排或正文摘要，以及查看、编辑、撤销入口。课程卡直接显示冲突课程名和周次；重复课程跳过。追加操作保留原课表、导入来源、节次与学期设置。

卡片在写入完成后立即保存，不等待模型总结。用户停止生成、模型续接失败或重启应用后，已经保存的结果仍然可见并可操作。同一条回复内等价的创建调用复用成功结果，避免重复保存。撤销只删除创建后未被编辑的记录；已编辑记录会保留，并告诉用户当前处理结果。

结果卡使用现有纸感面板和蓝绿配色，与普通回复保持清楚的层级。确认创建、提示冲突和显示撤销状态由文字与可用按钮表达；不能仅依赖颜色，流式回复更新也不使整张卡片重复入场。

## 0.4.0：启动状态与提醒后的操作

启动页沿用 D + 折页图标和 NEU-Dela 字标，说明正在加载工作台。数据就绪立即进入首页，不为展示品牌增加固定等待；加载失败显示原因和重试按钮。减少动态效果设置下保留状态文字与重试入口。

点击待办通知后显示主窗口，打开“今日便利贴”并定位到对应记录。用户可继续推迟提醒、完成或恢复，推迟后的时间保存为真实提醒时间。通知入口与日常待办页面使用同一份记录，避免只打开首页却找不到提醒对象。

系统通知横幅是否送达取决于系统权限、后台运行与勿扰设置。此次桌面检查验证与点击通知共用的导航处理，不将该结果写成横幅送达验证。

## 视觉系统

- 浅色页面 `#f2f1ed`，面板 `#faf9f6`，侧栏 `#e8ede9`。背景保持柔和的暖灰，不叠加影响文字阅读的颗粒图片。
- 深色页面 `#151f23`，面板 `#1e2b30`，侧栏 `#111c20`。继续使用对应的深色文字、输入框和边框。
- 主要操作使用蓝色，当前状态与完成反馈用青绿；课程沿用稳定配色。
- 侧栏收窄，导航选中状态使用底色、文字和左侧短线共同说明。保留最近对话的最小可用区域和底部设置；移除没有实际状态含义的固定绿色装饰点。
- 首页与聊天标题缩小，内容层级通过字号、间距和位置表达。控件保持键盘焦点轮廓。

## 图标

新的图标以 **D + 折页** 为主体：深蓝到青蓝的底色、奶白纸页、薄荷色折角。图标轮廓在小尺寸下保留明确的 D；不增加细字、星光、卡通表情或额外徽标。

正式资源为 `assets/icon.png`，同时用于 Mac/Windows 打包图标、应用内品牌、聊天欢迎区和助手头像。构建工具负责生成各平台要求的图标尺寸。

图标由 **imagegen 内置工具**生成，透明背景；未使用 API/CLI 回退。

最终生成提示词：

```text
Use case: logo-brand
Asset type: production app icon for Dola, a warm, calm personal study assistant desktop app for university students.
Create ONE standalone finished icon, square 1024 by 1024 composition, transparent pixels outside the icon shape. A premium macOS style softly rounded square tile occupies about 90% of the canvas, leaving uniform transparent outer padding. Tile color is a restrained deep ink-blue/navy with a gentle blue-teal gradient and very subtle soft material shading, clean edges. Center a bold beautifully simple ivory folded ribbon forming a distinct uppercase D silhouette, its curved inner negative space fully legible even at 32 pixels. The ribbon feels like a single open notebook page curling into the D, with a small mint/seafoam turned page tip at the lower right. Main symbol occupies 60% of the tile, extremely clean confident geometry, optical balance, one focal symbol. Mild tactile paper depth, not glossy glass, no photoreal scenery. Warm, approachable, refined, suitable for a serious personal productivity companion rather than a corporate dashboard. No eyes, no face, no robot, no graduation hat, no sparkles, no checkmarks, no text or wordmark other than the geometric D mark, no thin lines, no decorative dots, no extra frames, no presentation mockup, no grid, no device. Output the isolated icon asset only. Genuine transparency outside the rounded tile, all content centered.
```

工具实际输出为 1254×1254 PNG，包含透明通道；提示词中的 1024×1024 是请求尺寸，不能当作实际输出尺寸。

## 动效

| 场景                                 | 行为                             | 时间          |
| ------------------------------------ | -------------------------------- | ------------- |
| 页面标题和聊天欢迎区进入             | 淡入并上移 4px                   | 180ms         |
| 弹窗                                 | 遮罩淡入，面板上移 8px、轻微缩放 | 120ms / 200ms |
| 模型等选择菜单                       | 淡入并上移 3px                   | 140ms         |
| 选中日期、导航、搜索结果             | 颜色过渡，少量图标位移           | 120–150ms     |
| 切换日程日期、完成提示、展开积压事项 | 内容淡入                         | 160ms         |

日程仅在切换日期时重新入场。聊天流式文本和整页容器保持稳定，不随每个 token 或每次保存反复动画。系统启用“减少动态效果”时，关闭动画、过渡和这些交互位移，状态、文字、勾选和焦点提示仍保留。

实现参考 [WebKit 对减少动态效果的说明](https://webkit.org/blog/7551/responsive-design-for-motion/)；整体身份与清晰度参考 [Apple 应用图标指南](https://developer.apple.com/design/human-interface-guidelines/app-icons)。这些原则用于指导取舍，不代表本应用获得平台认证。

## 实现位置

- `src/shared/theme.css`：统一颜色。
- `src/renderer/DashboardPage.tsx`、`dashboard-design.css`：首页信息层级和响应式布局。
- `src/renderer/App.tsx`、`style.css`：统一图标、导航、聊天欢迎区和提问草稿。
- `src/renderer/motion.css`：微动效与减少动态效果。
- `src/main/design-smoke.ts`、`scripts/design-smoke.ts`：本轮界面验证，使用隔离的人工数据。
- `src/renderer/components/StartupScreen.tsx`、`startup.css`：品牌启动状态、失败重试。
- `src/renderer/components/WorkspaceCreationCard.tsx`、`workspace-creations.css`：创建结果、查看编辑撤销与课程冲突说明。
- `src/main/workbench.ts`、`workspace.ts`、`chat.ts`、`ai.ts`：三个创建工具、本机保存与撤销、同回复等价调用复用、停止或续接失败后的结果保留。
- `src/main/index.ts`、`desktop.ts`、`src/preload/index.ts`、`src/shared/types.ts`、`src/renderer/App.tsx`、`WorkspacePages.tsx`：通知定位、提醒推迟与桌面导航接入。
- `src/main/actions-smoke.ts`、`scripts/actions-smoke.ts`：0.4.0 动作桌面验证；`tests/chat-actions.test.ts`、`tests/workbench-write.test.ts`：协议续接及创建撤销测试。

## 后续优先级

首次使用时，可以继续设计简短的“带入课表 → 记一件事 → 按需连接模型”引导。0.4.0 已补上提醒后的定位、推迟、完成与恢复入口；下一步应观察真实学生使用的模型能否准确区分建议与保存请求、是否正确追问缺失信息，并验证 Windows 实机显示和通知交互。首次使用引导尚未实现。

## 交付与验证

0.4.0 生产构建、最新类型检查和 10 个文件中的 123 项测试全部通过。开发版与最终 Mac 包各通过 11 项动作桌面检查，包含重启恢复，产出 6 张截图。Mac DMG 与 Windows x64 NSIS 均已放入 assets/output/releases，Windows 9 项包内资源检查全部通过，尚未在 Windows 实机运行，安装包未签名。本轮没有发送真实模型请求，也没有确认系统通知横幅送达。

公开界面图位于 `assets/screenshots/`，均使用人工数据。运行桌面验证后，明细与截图写入 `assets/output/actions-validation/` 或 `assets/output/design-validation/`；这些本机运行产物不随源码提交。
