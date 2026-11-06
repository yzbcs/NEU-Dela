# dsh-superagent 架构借鉴评估

调研日期：2026-11-07。官方仓库：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。本次固定读取提交 [`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4)，通过 GitHub connector 阅读 README、文档及核心源码；没有安装依赖、运行原型或验证真实账号。

## 结论与本轮范围

**可以借鉴，当前没有必要整包引入或替换 Pi。** 它的主要价值是持续接收事件、保存任务进展、安排执行会话，以及把结果送回原讨论；这些设计适合未来的长任务。Dola 现有单次校园查询与创建操作已经有相应的执行链。

官方 README 明确说明：这是供参考的研究原型，**不是官方 DeepSeek 产品**；公开代码不同于内部版本及相关文章中的实现，文章中的部分设计尚未实现。因此，下文只描述本提交可核实的行为，不将文章愿景视为已有能力。[README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/README.md)

本轮仅设计与评估，不接入或安装该框架，不改动 Dola 生产源码，也不启动模型质量或性能实验。

## 实际架构与 Pi 的分层关系

原型面向一个 GitHub 仓库，可选监听飞书。其应用执行链为：

```text
GitHub / 飞书事件
  → Trigger：保存、关联讨论串，投递给已有任务或进入评估
  → Eval：规则与模型判断是否接受、附加、忽略或停止
  → Ticket：记录任务来源、范围、输入和状态
  → Assignment：本次执行安排
  → Worker Session：读取原请求、调查、实施和验证
  → 报告、等待或交付；后续事件可继续该任务
```

`Passes` 每 2 秒及收到新事件时推动待执行操作和到期评估；`Engine` 在事务中维护领域状态。接受请求后创建 Ticket 和首个 Assignment，再排队启动 worker。[passes.ts:28–67](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/passes.ts#L28-L67)、[intake.ts:19–60](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/intake.ts#L19-L60)、[tickets.ts:37–55](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/tickets.ts#L37-L55)

**它不是中央规划器自动拆解全部工作的架构。** orchestrator 负责评估和路由，提示词明确要求它不添加实施计划；worker 自己读取原始请求、调查并选择方案。支持 todo 和子代理工具，不等于实现了独立的通用任务图规划算法。[orchestrator.md:1–5](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/prompts/orchestrator.md#L1-L5)、[dispatch.md:14–40](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/prompts/dispatch.md#L14-L40)

| 层次         | 原型的实现                                                         | Dola 当前实现与关系                                                |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 应用任务编排 | Trigger、Ticket、Assignment、订阅、后台配额、报告与交付            | 当前以用户发起的聊天回合为主；未来长任务可借鉴这一层               |
| Agent 运行时 | DeepSeek Harness Session、工具循环、inbox、事件和持久化            | Pi 1.5.0 `AgentSession`、完整 JSONL 和自动压缩已承担这一层         |
| 领域操作     | GitHub/飞书业务工具，加 Harness 文件、shell、搜索、job、子代理工具 | 九个结构化校园工具，经 `WorkbenchReader` 和 `Store` 读取或保存实体 |
| 产品交互     | Harness Web 面板、原讨论串回传                                     | Electron 工作台、来源引用、真实保存回执、查看与撤销                |

Dola 当前职责和接口见 [Pi 运行时说明](pi-runtime.md)。两者可在应用设计上借鉴，但不是同一套 Session、工具或持久化接口。

## 已实现能力与依赖边界

- **上下文组织：** 每个 Ticket 复用自己的持久 Session；确认原消息仍在历史后，后续 Assignment 只传新增信息。长内容提供预览和完整读取入口。worker 必须回读原始来源，路由标题或摘要不能替代原请求、不能增加要求。[dsh.ts:441–468](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L441-L468)、[work.md:21–27](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/prompts/work.md#L21-L27)
- **压缩与子代理：** preset 启用 Harness 的压缩、工具结果裁剪和 spawn 子代理插件。仓库负责把子代理、shell job 与 Ticket 生命周期连接，后台工作完成会唤醒 worker；并未自行实现这些底层推理与压缩能力。[cordis.patch.yml:79–111](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/cordis.patch.yml#L79-L111)、[background.ts:16–30](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/background.ts#L16-L30)
- **任务恢复与交付：** Effects 将待执行操作先保存到 SQLite，再按并发限制执行和重试；Outbox 保存外发消息及交付状态。任务状态区分运行中、空闲等待、等待用户和可供审阅，模型结束一轮不等于任务完成。[effects.ts:42–71](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L42-L71)、[outbox.ts:17–50](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/outbox.ts#L17-L50)、[stage.ts:5–20](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/stage.ts#L5-L20)
- **工具分工：** 主会话有 14 个应用工具，处理路由、评估、配置和回传；worker 有 6 个应用工具，处理报告、确认和讨论串关系，另使用 Harness 的工作工具。这些工具围绕代码仓库任务，不能直接替代校园工具。[007-architecture.md:490–532](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/007-architecture.md#L490-L532)
- **执行环境：** 每个 Ticket 有独立目录与 Session，但以操作者 OS 用户执行，并设置 `danger-full-access`；这不表示容器隔离。目录用于分开工作现场，不能从 YAML 的 `isolate` 字段推导操作系统隔离。[sessions.ts:138–152](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/sessions.ts#L138-L152)、[003-execution.md:25–29](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/003-execution.md#L25-L29)
- **模型依赖：** eval 和 executor 可分别配置 provider/model，经 Harness 解析；没有硬编码只能使用 DeepSeek 模型。运行时则依赖 Harness/Cordis 服务。源码可配置不能证明任意第三方模型均已兼容或测过。[policy.ts:70–96](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/policy.ts#L70-L96)、[role-models.ts:7–20](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/role-models.ts#L7-L20)

## 值得借鉴什么、何时引入

**当前可沿用来源回读和按需上下文。** 查询先提供有意义的索引、记录 ID 和读取入口，需要时再读正文；保存用户原始约束，避免下一阶段只拿到模型摘要。Dola 现有查询、资料和邮件读取工具已经适合承载这一做法，无需更换运行时。

**出现跨回合长任务后，再增加独立任务记录与事件接续。** 例如用户要求整理多门课的资料、生成复习计划，并在新增讲义后继续更新。任务需要保存输入、产物和等待原因；资料处理结束后继续执行，而不是由模型反复轮询。可先在 Pi 上实现一个具体流程，不必立即搬入全部 Ticket、Effects 和 Outbox。

**出现独立并行子问题后，再增加有限子代理。** 多门课或多份互不依赖资料可以并行读取和分析；单次创建待办、课程或笔记通常不需要分派。汇总及最终保存仍应使用现有校园工具，让真实回执和撤销保持一致。

**主动工作需要节制通知。** 原型将普通进度留在内部，有可用结果或具体用户问题时才回传。这适合未来的后台校园助手，可避免每次轮询都通知用户。[000-philosophy.md:9–21](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/000-philosophy.md#L9-L21)

只有当产品目标转向“团队在 GitHub/飞书持续交办代码仓库任务”时，整包部署才与该原型的现成领域模型相符。校园学习助手可借鉴上面的机制，但目前没有相同的整包需求。

## 调用、接入与维护成本

增加路由会话和 worker 会话，会引入额外评估、交接及汇总调用；并行子代理可能缩短部分等待时间，也会增加总 token 和并发开销。当前未运行对照，因此没有速度、费用或质量收益的数字结论。

直接替换或桥接需要处理以下实际差异：

- **运行时与记录：** Pi 的 `AgentSession`、事件、`ToolDefinition` 和 JSONL，与 Harness 的 Session controller、inbox、Cordis 工具注册及持久化接口不同。聊天恢复、取消、工具结果和压缩状态需要重新接通。
- **业务行为：** GitHub PR/Ticket、飞书线程与校园课程、待办、笔记不是同一模型。Dola 的真实保存回执、重复创建处理、停止后保留结果及撤销行为都需要保留并验证，原型不会自动提供这些校园语义。
- **部署与界面：** 原型依赖 Harness 0.2.1-alpha.2 系列及多项 Cordis/Harness 服务、Web 客户端组件；不是向 Electron 项目添加一个独立编排函数即可使用。[package.json:53–85](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/package.json#L53-L85)

建议保留现有 **Pi + 九个校园工具 + 保存回执与撤销路径**。后续若确定一个跨回合资料任务，先补充该任务必需的持久状态、来源回读和完成唤醒，再根据真实负载判断是否需要子代理；本次调研不授权或执行该后续实现。
