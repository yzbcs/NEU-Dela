import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureText, fixtureToolResults, startMockServer } from '../scripts/mock-server';
import { ChatService } from '../src/main/chat';
import { Store } from '../src/main/store';
import type { Protocol } from '../src/shared/types';

const codec = {
  encrypt: (text: string) => Buffer.from(text),
  decrypt: (bytes: Buffer) => bytes.toString(),
};
const protocols: Protocol[] = ['openai-responses', 'openai-chat', 'anthropic'];
let directory: string;
let store: Store;
let service: ChatService;
let mock: Awaited<ReturnType<typeof startMockServer>>;

beforeAll(async () => {
  mock = await startMockServer({ delayMs: 0 });
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  const root = resolve('assets/output/test-state');
  mkdirSync(root, { recursive: true });
  directory = mkdtempSync(join(root, 'pi-session-'));
  store = new Store(directory, codec);
  service = new ChatService(store, () => {});
});
afterEach(() => {
  service.stopAll();
  rmSync(directory, { recursive: true, force: true });
});

function provider(protocol: Protocol) {
  return store.saveProvider({
    name: 'Pi 本地协议夹具',
    protocol,
    baseUrl: mock.url + '/v1',
    model: 'dola-fixture-model',
    apiKey: 'fixture-pi-session-key',
  });
}
function reopen() {
  service.stopAll();
  store = new Store(directory, codec);
  service = new ChatService(store, () => {});
}
function sessionFiles() {
  const root = join(directory, 'pi-sessions');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(root, name));
}
function sessionEntries(path: string) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
function wireText(body: any) {
  return (body.input ?? body.messages ?? [])
    .map((message: any) => fixtureText(message.content))
    .join('\n');
}

describe.each(protocols)('%s Pi 会话', (protocol) => {
  it('重启后保留完整工具调用与结果，下一次请求继续携带真实轨迹', async () => {
    const id = store.createChat(provider(protocol).id);
    await service.send(id, '保存一个提醒 [repeat-write]');
    const receipt = store.chat(id).messages.at(-1)?.creations?.[0];
    expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
    expect(receipt).toBeDefined();
    const files = sessionFiles();
    expect(files).toHaveLength(1);
    const entries = sessionEntries(files[0]);
    expect(entries.some((entry) => entry.message?.role === 'toolResult')).toBe(true);
    expect(
      entries.some((entry) =>
        entry.message?.content?.some?.((block: any) => block.type === 'toolCall'),
      ),
    ).toBe(true);

    reopen();
    const before = mock.requests.length;
    await service.send(id, '继续说明上一轮已保存的内容，不创建新记录');
    expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
    const requests = mock.requests.slice(before);
    expect(requests).toHaveLength(1);
    const results = fixtureToolResults(requests[0].body);
    expect(results.map((result) => result.name)).toEqual(['create_todo', 'create_todo']);
    expect(results[0].payload.data.todo.id).toBe(receipt!.record.id);
    expect(results[1].payload).toMatchObject({ repeatedCall: true, data: results[0].payload.data });
    expect(store.workspace.todos).toHaveLength(1);
    expect(store.chat(id).messages[1].creations?.[0]).toEqual(receipt);
  });

  it('已有工具轨迹后关闭工作台访问，本次不提供或执行工具', async () => {
    const id = store.createChat(provider(protocol).id);
    await service.send(id, '保存一个提醒 [repeat-write]');
    expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
    expect(store.workspace.todos).toHaveLength(1);
    const before = mock.requests.length;
    const original = structuredClone(store.workspace);
    await service.send(id, '再保存一个提醒 [repeat-write]', false);
    const requests = mock.requests.slice(before);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.tools ?? []).toEqual([]);
    expect(store.workspace).toEqual(original);
    expect(store.chat(id).messages.at(-1)).toMatchObject({ state: 'complete' });
    expect(store.chat(id).messages.at(-1)?.creations).toBeUndefined();
    expect(store.chat(id).messages.at(-1)?.activity).toBeUndefined();
  });
});

it('旧聊天首次迁入 Pi 历史，重启继续发送时不重复导入', async () => {
  const id = store.createChat(provider('openai-responses').id);
  store.chat(id).messages.push(
    {
      id: randomUUID(),
      role: 'user',
      text: '旧用户要求：周末整理课程资料',
      createdAt: '2026-11-01T00:00:00.000Z',
      state: 'complete',
    },
    {
      id: randomUUID(),
      role: 'assistant',
      text: '旧助手回答：先列课程，再分类笔记',
      createdAt: '2026-11-01T00:00:01.000Z',
      state: 'complete',
    },
  );
  store.saveChats();
  reopen();
  await service.send(id, '沿用原来的计划继续');
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
  expect(wireText(mock.requests.at(-1)!.body)).toContain('旧用户要求：周末整理课程资料');
  expect(wireText(mock.requests.at(-1)!.body)).toContain('旧助手回答：先列课程，再分类笔记');
  expect(sessionFiles()).toHaveLength(1);

  reopen();
  await service.send(id, '补充下一步');
  const text = wireText(mock.requests.at(-1)!.body);
  expect(text.match(/旧用户要求：周末整理课程资料/g)).toHaveLength(1);
  expect(text.match(/旧助手回答：先列课程，再分类笔记/g)).toHaveLength(1);
  expect(store.chat(id).messages).toHaveLength(6);
});

it.each([
  ['openai-responses', 'anthropic', '/v1/messages'],
  ['anthropic', 'openai-chat', '/v1/chat/completions'],
  ['openai-chat', 'openai-responses', '/v1/responses'],
] as const)('%s 切到 %s 后保留工具结果并可继续', async (from, to, endpoint) => {
  const id = store.createChat(provider(from).id);
  await service.send(id, '保存后再切换模型 [repeat-write]');
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
  const created = store.chat(id).messages.at(-1)?.creations?.[0];
  expect(created).toBeDefined();
  const target = provider(to);
  service.selectModel(id, target.id, target.model);
  const before = mock.requests.length;
  await service.send(id, '请根据刚才的保存结果继续说明');
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
  const requests = mock.requests.slice(before);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].path, mock.url).pathname).toBe(endpoint);
  expect(
    fixtureToolResults(requests[0].body).some(
      (result) =>
        result.name === 'create_todo' && result.payload.data.todo.id === created!.record.id,
    ),
  ).toBe(true);
  expect(store.workspace.todos).toHaveLength(1);
});

it('撤销后下一轮同步撤销状态，重启仍不把记录当作当前有效事项', async () => {
  const id = store.createChat(provider('openai-responses').id);
  await service.send(id, '保存一个提醒 [repeat-write]');
  const reply = store.chat(id).messages.at(-1)!;
  const creation = reply.creations![0];
  service.undoCreation(id, reply.id, creation.id);
  reopen();
  await service.send(id, '说明刚才那条记录的当前状态');
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
  expect(
    mock.requests.at(-1)!.body.input.some((message: any) => {
      const text = fixtureText(message.content);
      return text.includes('已撤销') && text.includes(creation.record.id);
    }),
  ).toBe(true);
  expect(store.chat(id).messages[1].creations?.[0].status).toBe('undone');
  expect(store.workspace.todos).toEqual([]);
});

it('长对话自动通过本地模型压缩，持久化摘要并保留最近用户轮次', async () => {
  const id = store.createChat(provider('openai-responses').id);
  for (let index = 0; index < 3; index++) {
    store.chat(id).messages.push(
      {
        id: randomUUID(),
        role: 'user',
        text: `历史段${index}：` + '旧资料'.repeat(5334),
        createdAt: new Date(index * 2000).toISOString(),
        state: 'complete',
      },
      {
        id: randomUUID(),
        role: 'assistant',
        text: `已经阅读历史段${index}`,
        createdAt: new Date(index * 2000 + 1000).toISOString(),
        state: 'complete',
      },
    );
  }
  store.saveChats();
  const before = mock.requests.length;
  await service.send(id, '最近需要完成课程整理 [recent-turn-sentinel] [compact-after]');
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
  await expect
    .poll(
      () =>
        sessionFiles()
          .flatMap(sessionEntries)
          .some(
            (entry) =>
              entry.type === 'compaction' && entry.summary.includes('[fixture-compaction-summary]'),
          ),
      { timeout: 5000, interval: 20 },
    )
    .toBe(true);
  expect(
    mock.requests
      .slice(before)
      .some((request) => wireText(request.body).includes('<conversation>')),
  ).toBe(true);
  reopen();
  await service.send(id, '沿用最近的安排继续');
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
  const request = wireText(mock.requests.at(-1)!.body);
  expect(request).toContain('[fixture-compaction-summary]');
  expect(request).toContain('[recent-turn-sentinel]');
  expect(request).not.toContain('历史段0：');
  expect(store.chat(id).messages[0].text).toContain('历史段0：');
});

it('删除聊天同时删除对应 Pi 文件，其他聊天仍可恢复', async () => {
  const selected = provider('openai-responses');
  const removedId = store.createChat(selected.id);
  const keptId = store.createChat(selected.id);
  await service.send(removedId, '即将删除的会话');
  await service.send(keptId, '保留的会话');
  expect(sessionFiles()).toHaveLength(2);
  const removedFiles = sessionFiles().filter((path) => sessionEntries(path)[0].id === removedId);
  expect(removedFiles).toHaveLength(1);
  await service.removeChat(removedId);
  expect(removedFiles.every((path) => !existsSync(path))).toBe(true);
  expect(sessionFiles()).toHaveLength(1);
  reopen();
  expect(store.chats.some((chat) => chat.id === removedId)).toBe(false);
  await service.send(keptId, '继续保留的会话');
  expect(store.chat(keptId).messages.at(-1)?.state).toBe('complete');
  expect(wireText(mock.requests.at(-1)!.body)).toContain('保留的会话');
});

it('服务错误回显人工密钥时，界面和新增 Pi 会话文件均不保留明文', async () => {
  const id = store.createChat(provider('openai-responses').id);
  await service.send(id, '[http401-echo-key]');
  const reply = store.chat(id).messages.at(-1)!;
  expect(reply.state).toBe('error');
  expect(reply.error).toContain('[已隐藏密钥]');
  expect(JSON.stringify(store.chat(id))).not.toContain('fixture-pi-session-key');
  expect(sessionFiles()).toHaveLength(1);
  expect(readFileSync(sessionFiles()[0], 'utf8')).not.toContain('fixture-pi-session-key');
});
