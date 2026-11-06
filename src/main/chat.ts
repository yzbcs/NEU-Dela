import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AppState, ChatMessage, ProviderConnectionInput } from '../shared/types';
import { describeError, listModels, streamReply, type ModelTurn } from './ai';
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
    chat.messages.push(user);
    const history: ModelTurn[] = chat.messages.map((m) => ({
      role: m.role,
      text:
        m.text +
        (m.creations?.length
          ? '\n\n工作台实际操作记录：' +
            JSON.stringify(
              m.creations.map(({ kind, status, record }) => ({ kind, status, record })),
            )
          : ''),
    }));
    chat.messages.push(reply);
    chat.model = provider.model;
    chat.workspaceAccess = workspaceAccess;
    chat.updatedAt = now;
    const controller = new AbortController();
    this.running.set(chatId, controller);
    this.store.saveChats();
    this.changed();
    try {
      let remainingCalls = 12;
      const completedWrites: { name: string; args: unknown; result: WorkbenchResult }[] = [];
      for (let round = 0; round <= 6; round++) {
        controller.signal.throwIfAborted();
        let roundText = '';
        if (round && reply.text) reply.text += '\n\n';
        const result = await streamReply(
          provider,
          key,
          history,
          controller.signal,
          (delta) => {
            roundText += delta;
            reply.text += delta;
            this.changed();
          },
          undefined,
          workspaceAccess
            ? {
                tools: round < 6 && remainingCalls > 0 ? workbenchTools : [],
                context:
                  this.workbench.summary() +
                  (round >= 6 || remainingCalls <= 0
                    ? '本轮工具操作已结束，请直接根据已有结果回答。'
                    : ''),
              }
            : undefined,
        );
        if (result.usage)
          reply.usage = {
            input: (reply.usage?.input ?? 0) + result.usage.input,
            output: (reply.usage?.output ?? 0) + result.usage.output,
          };
        if (result.incomplete) {
          reply.state = 'incomplete';
          return;
        }
        if (!result.toolCalls?.length) {
          reply.state = 'complete';
          return;
        }
        if (!workspaceAccess || round >= 6)
          throw new Error(
            '模型仍要求调用工具，但工作台访问已关闭或达到本次上限，请缩小问题范围后再试。',
          );
        history.push({
          role: 'assistant',
          text: roundText,
          toolCalls: result.toolCalls,
          responseItems: result.responseItems,
          anthropicContent: result.anthropicContent,
          reasoningContent: result.reasoningContent,
        });
        for (const call of result.toolCalls) {
          controller.signal.throwIfAborted();
          const activity = {
            id: call.id,
            label: activityLabel(call.name),
            status: 'reading' as const,
          };
          reply.activity ??= [];
          reply.activity.push(activity);
          const step = reply.activity.at(-1)!;
          this.changed();
          try {
            if (remainingCalls-- <= 0)
              throw new Error('本次已执行 12 项工具操作，请基于已有结果回答，或让用户分开提问。');
            const creates = ['create_todo', 'add_courses', 'create_note'].includes(call.name);
            const args: unknown = creates
              ? normalizeCreationArguments(call.name, call.arguments)
              : undefined;
            const previous = creates
              ? completedWrites.find(
                  (item) => item.name === call.name && isDeepStrictEqual(item.args, args),
                )
              : undefined;
            const result =
              previous?.result ??
              (await this.workbench.execute(call.name, call.arguments, controller.signal));
            if (creates && !previous) completedWrites.push({ name: call.name, args, result });
            if (result.creations?.length && !previous) {
              reply.creations ??= [];
              reply.creations.push(...result.creations);
              // The record is already saved. Preserve its receipt even if generation is stopped.
              this.store.saveChats();
            }
            let citation: string | undefined;
            if (result.source) {
              const resultSource = result.source;
              reply.sources ??= [];
              let source = reply.sources.find(
                (s) =>
                  s.kind === resultSource.kind &&
                  s.id === resultSource.id &&
                  s.label === resultSource.label,
              );
              if (!source) {
                source = { ...resultSource, citation: reply.sources.length + 1 };
                reply.sources.push(source);
              }
              citation = `[${source.citation}]`;
            }
            history.push({
              role: 'tool',
              toolCallId: call.id,
              text: this.store.redact(
                JSON.stringify({
                  citation,
                  data: result.data,
                  ...(previous
                    ? { repeatedCall: true, message: '已返回本轮先前保存的结果，没有重复创建。' }
                    : {}),
                }),
              ),
            });
            step.status = 'done';
            step.detail = this.store.redact(result.detail);
            this.changed();
            controller.signal.throwIfAborted();
          } catch (error) {
            if (controller.signal.aborted) {
              if (step.status !== 'done') step.status = 'stopped';
              throw error;
            }
            const detail = this.store.redact(
              error instanceof Error ? error.message : String(error),
            );
            step.status = 'error';
            step.detail = detail;
            history.push({
              role: 'tool',
              toolCallId: call.id,
              text: JSON.stringify({ error: detail }),
              isError: true,
            });
          }
          this.changed();
        }
      }
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
