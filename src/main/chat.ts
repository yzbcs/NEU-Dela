import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { rmSync } from 'node:fs';
import {
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { AppState, ChatMessage, ProviderConnectionInput } from '../shared/types';
import { describeError, listModels, streamReply } from './ai';
import { createChatSession, savedSessionPath } from './pi-session';
import type { Store } from './store';
import { sdkBaseUrl } from '../shared/validation';
import {
  WorkbenchReader,
  activityLabel,
  workbenchTools,
  normalizeCreationArguments,
  type WorkbenchResult,
} from './workbench';

export class ChatService {
  private running = new Map<string, AbortController>();
  private workbench: WorkbenchReader;
  constructor(
    readonly store: Store,
    private publish: (state: AppState) => void,
  ) {
    this.workbench = new WorkbenchReader(store);
  }
  changed() {
    this.publish(this.store.snapshot());
  }
  busy(chatId: string) {
    return this.running.has(chatId);
  }

  async send(chatId: string, text: string, workspaceAccess = true): Promise<void> {
    const chat = this.store.chat(chatId);
    if (this.busy(chatId)) throw new Error('请先等待当前回复结束或停止生成');
    if (!text.trim()) throw new Error('请输入消息');
    if (!chat.providerId) throw new Error('请先添加并选择模型服务');
    const saved = this.store.provider(chat.providerId);
    const provider = { ...saved, model: chat.model || saved.model };
    const key = this.store.key(provider.id);
    const now = new Date().toISOString();
    const user: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text: text.trim(),
      createdAt: now,
      state: 'complete',
    };
    const reply: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: now,
      state: 'streaming',
      model: provider.model,
      providerName: provider.name,
    };
    if (!chat.messages.length) chat.title = Array.from(user.text).slice(0, 28).join('');
    const history = [...chat.messages];
    chat.messages.push(user);
    chat.messages.push(reply);
    chat.model = provider.model;
    chat.workspaceAccess = workspaceAccess;
    chat.updatedAt = now;
    const controller = new AbortController();
    this.running.set(chatId, controller);
    this.store.saveChats();
    this.changed();
    let session: AgentSession | undefined;
    let limitError: Error | undefined;
    let toolRounds = 0;
    let toolCalls = 0;
    let roundHasText = false;
    let lastStopReason = '';
    const abortSession = () => void session?.abort();
    controller.signal.addEventListener('abort', abortSession, { once: true });
    const completedWrites: { name: string; args: unknown; result: WorkbenchResult }[] = [];
    const tools: ToolDefinition[] = workspaceAccess
      ? workbenchTools.map((tool) => ({
          ...tool,
          label: activityLabel(tool.name),
          parameters: tool.parameters as ToolDefinition['parameters'],
          executionMode: 'sequential',
          execute: async (_toolCallId, params, signal) => {
            if (++toolCalls > 12) throw new Error('本次已执行 12 项工具操作，请基于已有结果回答。');
            const raw = JSON.stringify(params);
            const creates = ['create_todo', 'add_courses', 'create_note'].includes(tool.name);
            const args = creates ? normalizeCreationArguments(tool.name, raw) : undefined;
            const previous = creates
              ? completedWrites.find(
                  (item) => item.name === tool.name && isDeepStrictEqual(item.args, args),
                )
              : undefined;
            try {
              const result =
                previous?.result ??
                (await this.workbench.execute(tool.name, raw, signal ?? controller.signal));
              if (creates && !previous) completedWrites.push({ name: tool.name, args, result });
              if (result.creations?.length && !previous) {
                reply.creations ??= [];
                reply.creations.push(...result.creations);
                // Persist the real write before Pi requests the model's continuation.
                this.store.saveChats();
              }
              let citation: string | undefined;
              if (result.source) {
                const sourceInfo = result.source;
                reply.sources ??= [];
                let source = reply.sources.find(
                  (item) =>
                    item.kind === sourceInfo.kind &&
                    item.id === sourceInfo.id &&
                    item.label === sourceInfo.label,
                );
                if (!source) {
                  source = { ...sourceInfo, citation: reply.sources.length + 1 };
                  reply.sources.push(source);
                }
                citation = `[${source.citation}]`;
              }
              this.changed();
              return {
                content: [
                  {
                    type: 'text',
                    text: this.store.redact(
                      JSON.stringify({
                        citation,
                        data: result.data,
                        ...(previous
                          ? {
                              repeatedCall: true,
                              message: '已返回本轮先前保存的结果，没有重复创建。',
                            }
                          : {}),
                      }),
                    ),
                  },
                ],
                details: { detail: this.store.redact(result.detail) },
              };
            } catch (error) {
              throw new Error(
                this.store.redact(error instanceof Error ? error.message : String(error)),
              );
            }
          },
        }))
      : [];
    try {
      session = await createChatSession({
        store: this.store,
        chat,
        history,
        provider,
        apiKey: key,
        tools,
        workspaceContext: workspaceAccess ? this.workbench.summary() : undefined,
      });
      controller.signal.throwIfAborted();
      session.subscribe((event) => {
        if (event.type === 'message_start' && event.message.role === 'assistant')
          roundHasText = false;
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          if (!roundHasText && reply.text) reply.text += '\n\n';
          roundHasText = true;
          reply.text += event.assistantMessageEvent.delta;
          this.changed();
        } else if (event.type === 'message_end' && event.message.role === 'assistant') {
          const message = event.message;
          // Pi emits this event before it writes the final message to its session file.
          if (message.errorMessage) message.errorMessage = this.store.redact(message.errorMessage);
          lastStopReason = message.stopReason;
          reply.usage = {
            input:
              (reply.usage?.input ?? 0) +
              message.usage.input +
              message.usage.cacheRead +
              message.usage.cacheWrite,
            output: (reply.usage?.output ?? 0) + message.usage.output,
          };
          if (message.stopReason === 'error')
            reply.error = describeError(new Error(message.errorMessage || '模型请求失败'), key);
          if (
            message.content.some((part) => part.type === 'toolCall') &&
            (!workspaceAccess || toolRounds >= 6)
          ) {
            limitError = new Error(
              '模型仍要求调用工具，但工作台访问已关闭或达到本次上限，请缩小问题范围后再试。',
            );
            session!.agent.abort();
          }
        } else if (event.type === 'tool_execution_start') {
          reply.activity ??= [];
          reply.activity.push({
            id: event.toolCallId,
            label: activityLabel(event.toolName),
            status: 'reading',
          });
          this.changed();
        } else if (event.type === 'tool_execution_end') {
          const step = reply.activity?.find((item) => item.id === event.toolCallId);
          if (step) {
            step.status = event.isError
              ? controller.signal.aborted
                ? 'stopped'
                : 'error'
              : 'done';
            const result = event.result as {
              content?: { type: string; text?: string }[];
              details?: { detail?: string };
            };
            step.detail = this.store.redact(
              result.details?.detail ??
                result.content
                  ?.filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join('\n') ??
                '',
            );
          }
          this.changed();
        } else if (event.type === 'turn_end') {
          if (
            event.message.role === 'assistant' &&
            event.message.content.some((part) => part.type === 'toolCall')
          )
            toolRounds++;
          if (toolRounds >= 6 || toolCalls >= 12) session!.setActiveToolsByName([]);
        } else if (event.type === 'compaction_start') {
          reply.activity ??= [];
          reply.activity.push({
            id: 'compaction-' + randomUUID(),
            label: '整理对话上下文',
            status: 'reading',
          });
          this.changed();
        } else if (event.type === 'compaction_end') {
          const step = reply.activity?.findLast(
            (item) => item.label === '整理对话上下文' && item.status === 'reading',
          );
          if (step) {
            step.status = event.aborted ? 'stopped' : event.errorMessage ? 'error' : 'done';
            step.detail = event.errorMessage
              ? this.store.redact(event.errorMessage)
              : '已保留近期对话并整理较早内容。';
          }
          this.changed();
        }
      });
      await session.prompt(user.text, { expandPromptTemplates: false });
      if (limitError) throw limitError;
      if (controller.signal.aborted || lastStopReason === 'aborted') reply.state = 'stopped';
      else if (lastStopReason === 'error') reply.state = 'error';
      else if (lastStopReason === 'length') reply.state = 'incomplete';
      else if (!reply.text && !reply.creations?.length)
        throw new Error('模型没有返回文字，请检查模型 ID 或接口类型。');
      else reply.state = 'complete';
      if (
        reply.state === 'error' &&
        workspaceAccess &&
        /(?:tool|function.?call)/i.test(reply.error ?? '')
      )
        reply.error +=
          ' 如果该服务不支持工具调用，可关闭“工作台访问”进行普通聊天，或切换支持工具的模型。';
    } catch (error) {
      if (controller.signal.aborted) reply.state = 'stopped';
      else {
        reply.state = 'error';
        reply.error = this.store.redact(describeError(error, key));
        if (workspaceAccess && /(?:tool|function.?call)/i.test(reply.error))
          reply.error +=
            ' 如果该服务不支持工具调用，可关闭“工作台访问”进行普通聊天，或切换支持工具的模型。';
      }
    } finally {
      controller.signal.removeEventListener('abort', abortSession);
      session?.dispose();
      for (const step of reply.activity ?? [])
        if (step.status === 'reading')
          step.status = controller.signal.aborted ? 'stopped' : 'error';
      this.running.delete(chatId);
      chat.updatedAt = new Date().toISOString();
      this.store.saveChats();
      this.changed();
    }
  }

  stop(chatId: string) {
    this.running.get(chatId)?.abort();
  }
  undoCreation(chatId: string, messageId: string, creationId: string) {
    const chat = this.store.chat(chatId);
    if (this.busy(chatId)) throw new Error('请先停止生成或等待回复结束，再撤销新增记录。');
    const creation = chat.messages
      .find((message) => message.id === messageId)
      ?.creations?.find((item) => item.id === creationId);
    if (!creation) throw new Error('找不到这次新增记录');
    if (creation.status === 'undone') return;
    this.workbench.undoCreation(creation);
    creation.status = 'undone';
    this.store.saveChats();
    const sessionPath = savedSessionPath(this.store, chatId);
    if (sessionPath)
      SessionManager.open(sessionPath).appendCustomMessageEntry(
        'workbench-change',
        `用户已撤销此前创建的${creation.kind}记录，ID：${creation.record.id}。当前工作台状态请重新查询。`,
        false,
      );
    this.changed();
  }
  removeChat(chatId: string) {
    this.store.chat(chatId);
    if (this.busy(chatId)) throw new Error('请先停止生成再删除会话');
    const sessionPath = savedSessionPath(this.store, chatId);
    if (sessionPath) rmSync(sessionPath);
    this.store.chats = this.store.chats.filter((chat) => chat.id !== chatId);
    this.store.saveChats();
    this.changed();
  }

  stopAll() {
    for (const controller of this.running.values()) controller.abort();
  }

  async listModels(input: ProviderConnectionInput) {
    const key = this.store.connectionKey(input);
    try {
      const models = await listModels(input, key);
      if (input.id) {
        const saved = this.store.provider(input.id);
        if (
          saved.protocol === input.protocol &&
          key === this.store.key(saved.id) &&
          sdkBaseUrl(saved.baseUrl, saved.protocol) === sdkBaseUrl(input.baseUrl, input.protocol)
        ) {
          this.store.saveModels(saved.id, models);
          this.changed();
        }
      }
      return models;
    } catch (error) {
      throw new Error(describeError(error, key));
    }
  }

  selectModel(chatId: string, providerId: string, model?: string) {
    const chat = this.store.chat(chatId);
    if (this.busy(chat.id)) throw new Error('生成结束后再切换模型');
    const provider = this.store.provider(providerId);
    chat.providerId = provider.id;
    chat.model = model ?? provider.model;
    this.store.saveChats();
    this.changed();
  }

  async probe(id: string) {
    const provider = this.store.provider(id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const started = Date.now();
    let text = '';
    try {
      await streamReply(
        provider,
        this.store.key(id),
        [{ role: 'user', text: '请只回复“连接正常”。' }],
        controller.signal,
        (delta) => {
          text += delta;
        },
        64,
      );
      return { text, milliseconds: Date.now() - started };
    } catch (error) {
      throw new Error(describeError(error, this.store.key(id)));
    } finally {
      clearTimeout(timer);
    }
  }
}
