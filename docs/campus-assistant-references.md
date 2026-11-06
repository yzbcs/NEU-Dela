# 校园个人助手参考与改进取舍

调研日期：2026-11-07。对照基线为本地 NEU Dola 0.3.6 的 README、`DashboardPage.tsx`、`App.tsx`、`desktop.ts` 与共享数据模型。远端阅读的是各仓库当日默认开发分支；以下区分项目文档声明、已阅读源码和对 Dola 的判断，没有在本机运行参考项目，也没有验证其真实校园账号。

前半部分记录搜索、未来安排与课程入口的改进依据；文末追加本次自然语言写入的源码复核与验证结果。文中“调研时只读”描述的是扩展写工具之前的状态。

## 判断

Dola 已有课程、待办、笔记、邮件和只读 AI，当前最明显的缺口是这些内容之间的连接：看完今日课程，还得切页查未来截止时间；记得某个关键词，却得猜它在哪个模块。先把已有本机数据变得更容易找、更容易安排，比立即增加成绩、回放、QQ 或更多模型接口更有用。

本轮实现统一搜索、未来安排，并接通课程详情到笔记与资料的入口。课前提醒值得下一步接上现有桌面通知，但它涉及关闭应用后是否运行、电脑休眠与重启的实际行为，需要作为独立功能落实。学校数据接入按东北大学真实页面和样例逐项推进。

## 五个项目的可借鉴部分

| 项目                                                                                | 核实的能力与证据                                                                                                                                                                                                                                                                                                                                                                                                     | 对 Dola 的实际启发                                                                                   | 不能直接推导的结论                                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [JLU-Dela](https://github.com/goya4140/JLU-Dela)                                    | [README](https://github.com/goya4140/JLU-Dela/blob/main/README.md) 描述课表、学习通作业与个人待办合并的学习日历；[study-calendar.ts](https://github.com/goya4140/JLU-Dela/blob/main/app/src/renderer/features/todo/study-calendar.ts) 确实将三类记录展开为统一条目，并用 Asia/Shanghai 生成日期与时间、按日期排序。文档另有原位课程资料、回放字幕与 AI 草稿。                                                        | 将现有课程和便利贴放到同一份未来安排中；明确区分有时间、无时间、逾期事项，点击后进入原记录。         | 吉大教务、学在吉大与学习通登录和页面适配不能证明东北大学已接入。其截图使用合成数据，不是我们的真实校园验证。       |
| [Dela / SJTU](https://github.com/Chang-Yo/Dela)                                     | [README](https://github.com/Chang-Yo/Dela/blob/dev/README.md) 描述跨模块搜索、TODO 与日历互通、Canvas 资料；[search/index.ts](https://github.com/Chang-Yo/Dela/blob/dev/src/main/search/index.ts) 读取已在本机的数据，查待办、项目、会话标题、缓存邮件正文与资料标题；[GlobalSearchDialog.tsx](https://github.com/Chang-Yo/Dela/blob/dev/src/renderer/features/search/GlobalSearchDialog.tsx) 将结果分组并提供跳转。 | 在 Dola 中统一搜索已加载的笔记正文、待办、课程、资料名称、会话；保留结果的类型和来源，减少跨页寻找。 | 原项目会话搜索仅查标题，不能写成全文搜索。Dola 邮件正文并未全部常驻本机，不能照搬“全局搜所有邮件”的承诺。          |
| [Bugaoshan / 四川大学](https://github.com/The-Brotherhood-of-SCU/Bugaoshan)         | [README](https://github.com/The-Brotherhood-of-SCU/Bugaoshan/blob/main/README.md) 包含非连续周次、ICS 与图片导出、课前提醒；[reminder_plan_builder.dart](https://github.com/The-Brotherhood-of-SCU/Bugaoshan/blob/main/lib/services/reminder/reminder_plan_builder.dart) 按有效教学周与自定义节次生成提前通知，并跳过非上课周及免打扰时间。                                                                          | Dola 已有周次解析、节次与系统通知，适合补课前提醒；判定必须服从实际课程周次，而不是每周固定重复。    | Android/iOS 的系统排程不能证明 Electron 退出后还能提醒；其川大成绩、教室与余额接口也不能移植为东北大学能力。       |
| [Student Reminder System / UiTM](https://github.com/syamxm/student_reminder_system) | [README](https://github.com/syamxm/student_reminder_system/blob/develop/README.md) 以课程与截止提醒为主；[class_notification_sync.dart](https://github.com/syamxm/student_reminder_system/blob/develop/lib/core/notifications/class_notification_sync.dart) 生成未来 14 天、提前 10 分钟的课程通知，并按教学日期过滤。                                                                                               | 课程提醒应带地点，点击后应回到相应课程；未来安排可以先做短时间窗口，保持清晰。                       | 文档自述 Android 已测、Web/iOS 未完整验证；其 Firebase 服务与账号体系不适合为本地个人 Dola 直接引入。              |
| [CourseRaptor](https://github.com/Health-525/courseraptor)                          | [README](https://github.com/Health-525/courseraptor/blob/main/README.md) 描述今日安排、自然语言待办和课程知识库；[school.ts](https://github.com/Health-525/courseraptor/blob/main/src/core/school.ts) 明确区分学校能力，手动导入模式没有在线成绩、考试、通知与选课能力，缓存通知携带获取时间。                                                                                                                       | 保留 Dola 无 AI 也可查看与操作的入口；根据当前确有的数据提供帮助。自然语言写待办可作为后续交互方向。 | 导入一份课表不等于接通其他教务数据。调研时 Dola 的 AI 为只读；扩展写入需要明确的用户请求，并复用既有记录保存逻辑。 |

## 本轮实现建议

### 1. 全局搜索：直接找到已有内容

入口放在侧栏，同时支持 Cmd/Ctrl+K。搜索结果按内容类型标明来源，显示命中的文本上下文并可打开原记录。笔记查标题与正文，待办查标题与详情，课程查名称、地点、教师与备注，资料查名称和分类，会话查已有本机记录。搜索不触发模型、不自动下载文件，也不为了搜索建立另一套内容存储。

主要使用场景：输入“实验报告”后同时看到有关待办、课程笔记和关联资料；从结果打开笔记前沿用已有保存逻辑，避免切页丢编辑。

### 2. 未来安排：把课程与截止事项放到一天里看

在已有工作台增加未来七天安排，依据北京时间展开真实课程周次与自定义节次。显示每天课程和截止事项，逾期待办与无时间事项单列，避免无时间事项被误放到某一天。重复待办只按当前已保存的下一次时间显示，不凭空生成未保存的完成记录。

主要使用场景：周末打开工作台即可看到下周课程和实验报告截止时间；点课程可核对课表，点待办可以直接编辑或完成。无首周日期时明确引导设置，不能误显示“未来七天无课程”。

### 3. 课程学习入口与后续方向

先让课程和已有通知模块连起来，再考虑增加可编辑的提前分钟数。提醒正文应包含课程时间和地点，遵循单双周、自定义节次和学期首周日期；课程提醒不要补发已经结束的课程。Electron 运行中提醒、托盘后台、退出与休眠的边界要在 Mac 真机验证，Windows 另做实机验证。

本轮已以课程详情为入口联动笔记与文件：新建本次课堂笔记会预填日期、时间、地点和教师，进入以课程名命名的笔记本；资料按钮进入同名分类。复用现有分类和关联资料，不建立第二套笔记存储。AI 继续沿用笔记页面的“问问 AI”。PDF 搜索和页码定位有实际价值，但需要完成正文提取、索引更新和文件移动后的使用流程，范围大于本轮搜索已存在的本机条目。

## 暂不直接实施的方向与所缺证据

- 东北大学成绩、考试、培养方案、公告与回放：需要当前官方入口、可读取页面或授权接口、真实脱敏样例；吉大与交大的实现只能帮助理解功能形态。
- 学习通作业同步：需要确认用户所在课程实际使用的平台、登录后页面结构与时间字段；没有这些证据时不能把其他项目的接入宣称为已适配。
- QQ 群消息、远程项目、终端、Skills/MCP 插件系统：这些会显著扩展产品边界与维护成本，当前校园学习流程已有更直接的改进空间。
- 云账号和跨设备同步：会新增服务运营与数据冲突问题，目前本机工作台的需求不要求引入。

本轮借鉴产品行为与数据呈现方式，按 Dola 现有结构实现；没有复制参考仓库源码或素材。

## 自然语言写入的源码复核与本次实现

### 上交 Dela 实际如何完成写入

本节固定核对上交 Dela 的 dev 提交 [`96bef2222093a5717c52a44f89cda6c6b277df7a`](https://github.com/Chang-Yo/Dela/tree/96bef2222093a5717c52a44f89cda6c6b277df7a)，避免将后续开发变化混入本次结论。以下是源码观察，没有运行该项目或使用校园账号。

1. **模型调用工具，主进程保存实体。** [commands.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/agent/commands.ts) 提供 `dela` 命令桥，模型通过 bash 调用这些命令；领域命令进入应用现有的 service 与 schema。例如 [todo/index.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/todo/index.ts#L14-L115) 保存待办并返回真实记录。成功结果来自完成后的实体写入，不靠模型文字宣称“已添加”。Dola 可以直接沿用现有三协议工具调用，不需要为了写待办再引入 bash 或命令桥。
2. **个人日程和学校课程是不同数据。** [create-event.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/agent/domain/timetable/create-event.ts) 与 [timetable/api.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/timetable/api.ts#L386-L408) 的 `create_event` 创建个人日程，不能据此宣称它支持向学校导入的课程表追加课程。Dola 的课程工具应接入本项目课程结构，保留学期、第一周日期、自定义节次和原有来源。
3. **笔记写入复用工作区入口。** [workspace/entries.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/agent/domain/workspace/entries.ts) 将创建操作交给既有工作区逻辑。对 Dola 的启发是把 AI 新建笔记接入用户手动保存笔记的同一条路径，避免出现聊天里显示成功、笔记列表却没有记录的分离状态。
4. **已核对的执行链未提供通用写入去重。** [session.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/agent/session.ts#L653-L689)、[commands.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/agent/commands.ts) 与 [extension-ui.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/agent/extension-ui.ts) 不能支持“模型重复调用也不会重复创建”的泛化结论。Dola 在同次回复内缓存成功写入结果，按规范化后的工具参数直接比较；重复请求返回原实体 ID，不再次保存。下一次用户消息可再次创建相同待办。
5. **通知点击需要携带目标记录。** [shared/notifications.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/shared/notifications.ts)、[notifications/system.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/main/notifications/system.ts) 和 [renderer/app/notifications.ts](https://github.com/Chang-Yo/Dela/blob/96bef2222093a5717c52a44f89cda6c6b277df7a/src/renderer/app/notifications.ts) 串起通知目标、窗口唤起和页面定位。Dola 对便利贴提醒传递真实待办 ID，点击后进入该条记录，才能接着完成、推迟或编辑。

### Dola 本次采用的范围

本次增加 `create_todo`、`add_courses` 与 `create_note`，分别复用便利贴、课程与笔记的保存逻辑。工具结果和聊天卡片使用实际保存的记录 ID 与内容；关闭工作台访问时不向模型提供这些工具。课程按完整批次追加，已有课表的学期和来源继续保留；缺少必需的课程参数时应询问用户，不能从任意钟点猜测节次。

记录保存成功后立即保存聊天回执，因此后续模型请求失败或用户停止文字生成，不会把已经发生的写入掩盖为“没有创建”。每张新增结果卡可打开记录，也可在生成结束后撤销本次新增。撤销只删除尚未被用户编辑的对应记录；已编辑的便利贴、课程或笔记会保留，并提示用户打开后处理。撤销状态与创建回执一起保存在聊天中，重启后仍可识别。

### 已运行的协议验证

`tests/chat-actions.test.ts` 通过真实 loopback HTTP 连接本地 SSE 夹具，覆盖 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages，共 21 项通过。每种协议分别验证三类创建及真实 ID、同次回复的等价参数去重、保存后 HTTP 500、保存后手动停止、关闭工作台访问、重启后逐条撤销、以及已编辑记录拒绝撤销。去重夹具同时改变 JSON 键序、补齐默认值，并将北京时间换成等价 UTC 时间；新用户消息仍可新增另一条同名待办。

夹具与临时 Store 使用人工数据及测试密钥，没有请求真实模型，也没有写入用户的真实工作台。该结果说明本机协议处理、实体保存和聊天回执可以联动，不证明真实模型会正确理解任意自然语言；桌面交互和系统通知行为以另外的桌面验证记录为准。
