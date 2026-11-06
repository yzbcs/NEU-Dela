import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureToolResults, startMockServer } from '../scripts/mock-server';
import { ChatService } from '../src/main/chat';
import { Store } from '../src/main/store';
import { WorkspaceService } from '../src/main/workspace';
import type { AppState, Protocol, WorkspaceCreation } from '../src/shared/types';

const codec = {
  encrypt: (text: string) => Buffer.from(text),
  decrypt: (data: Buffer) => data.toString(),
};
const protocols: Protocol[] = ['openai-responses', 'openai-chat', 'anthropic'];
let directory: string;
let store: Store;
let service: ChatService;
let mock: Awaited<ReturnType<typeof startMockServer>>;
let snapshots: AppState[];

beforeAll(async () => {
  mock = await startMockServer({ delayMs: 0 });
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  const root = resolve('assets/output/test-state');
  mkdirSync(root, { recursive: true });
  directory = mkdtempSync(join(root, 'chat-actions-'));
  store = new Store(directory, codec);
  store.workspace.timetable = {
    term: '人工测试学期',
    firstMonday: '2026-08-31',
    sourceName: '原有课表',
    sourcePath: '',
    courses: [
      {
        id: randomUUID(),
        name: '原有课程',
        day: 1,
        start: 1,
        end: 2,
        weeks: '1-16',
        location: '原教室',
        teacher: '',
        detail: '',
      },
    ],
  };
  store.saveWorkspace();
  snapshots = [];
  service = new ChatService(store, (state) => snapshots.push(structuredClone(state)));
});
afterEach(() => {
  service.stopAll();
  rmSync(directory, { recursive: true, force: true });
});

function createChat(protocol: Protocol) {
  const provider = store.saveProvider({
    name: '人工协议夹具',
    protocol,
    baseUrl: mock.url + '/v1',
    model: 'dola-fixture-model',
    apiKey: 'fixture-local-key',
  });
  return store.createChat(provider.id);
}

function savedRecord(source: Store, creation: WorkspaceCreation) {
  const items =
    creation.kind === 'todo'
      ? source.workspace.todos
      : creation.kind === 'course'
        ? source.workspace.timetable.courses
        : source.workspace.notes;
  return items.find((item) => item.id === creation.record.id);
}

describe.each(protocols)('%s 写入联动', (protocol) => {
  it('三类工具返回实际保存记录，消息回执、界面快照和重启数据一致', async () => {
    const id = createChat(protocol);
    const before = mock.requests.length;
    await service.send(id, '请添加便利贴、课程和笔记 [create-workspace]');
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('complete');
    expect(reply.creations?.map((creation) => creation.kind)).toEqual(['todo', 'course', 'note']);
    expect(reply.activity?.map((activity) => activity.status)).toEqual(['done', 'done', 'done']);
    expect(reply.creations?.find((creation) => creation.kind === 'todo')?.record).toMatchObject({
      title: '人工提醒',
      dueAt: '2026-12-01T11:30:00.000Z',
      reminder: true,
    });
    expect(reply.creations?.find((creation) => creation.kind === 'note')?.record).toMatchObject({
      title: '人工笔记',
      body: '正文\n- [ ] 待办',
      category: '课程笔记',
    });
    const requests = mock.requests.slice(before);
    expect(requests).toHaveLength(2);
    const toolResults = fixtureToolResults(requests[1].body);
    expect(toolResults.map((result) => result.name)).toEqual([
      'create_todo',
      'add_courses',
      'create_note',
    ]);
    const reopened = new Store(directory, codec);
    expect(reopened.chat(id).messages.at(-1)?.creations).toEqual(reply.creations);
    for (const creation of reply.creations!) {
      expect(creation.status).toBe('created');
      expect(savedRecord(reopened, creation)).toEqual(creation.record);
      expect(JSON.stringify(toolResults)).toContain(creation.record.id);
      expect(reply.text).toContain(creation.record.id);
    }
    expect(
      snapshots.some((snapshot) => {
        const message = snapshot.chats.find((chat) => chat.id === id)?.messages.at(-1);
        return message?.state === 'streaming' && message.creations?.length === 3 && !message.text;
      }),
    ).toBe(true);
    expect(reopened.workspace.timetable.sourceName).toBe('原有课表');
    expect(reopened.workspace.timetable.courses.map((course) => course.name)).toEqual([
      '原有课程',
      '人工新增课程',
    ]);
  });

  it('同次回复中等价参数只写一次，新的用户请求仍可创建另一条', async () => {
    const id = createChat(protocol);
    const before = mock.requests.length;
    await service.send(id, '请添加提醒 [repeat-write]');
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('complete');
    expect(store.workspace.todos).toHaveLength(1);
    expect(reply.creations).toHaveLength(1);
    expect(reply.activity?.map((activity) => activity.status)).toEqual(['done', 'done']);
    const requests = mock.requests.slice(before);
    expect(requests).toHaveLength(3);
    const results = fixtureToolResults(requests[2].body);
    expect(results).toHaveLength(2);
    expect(results[1].payload).toMatchObject({ repeatedCall: true, data: results[0].payload.data });
    await service.send(id, '再添加一条相同提醒 [repeat-write]');
    expect(store.workspace.todos).toHaveLength(2);
    expect(new Set(store.workspace.todos.map((todo) => todo.id)).size).toBe(2);
    expect(store.chat(id).messages.at(-1)?.creations).toHaveLength(1);
  });

  it('保存成功后模型续接失败，保留真实记录与成功回执', async () => {
    const id = createChat(protocol);
    const before = mock.requests.length;
    await service.send(id, '请添加便利贴 [write-then-fail]');
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('error');
    expect(reply.error).toContain('记录保存后模型续接失败');
    expect(reply.creations).toHaveLength(1);
    expect(reply.activity?.[0].status).toBe('done');
    expect(mock.requests.slice(before)).toHaveLength(2);
    const reopened = new Store(directory, codec);
    expect(reopened.chat(id).messages.at(-1)).toEqual(reply);
    expect(savedRecord(reopened, reply.creations![0])).toEqual(reply.creations![0].record);
  });

  it('保存后停止文字生成，已落盘的回执与记录不撤销', async () => {
    const id = createChat(protocol);
    const task = service.send(id, '请添加便利贴 [write-slow]');
    try {
      await expect
        .poll(() => Boolean(store.chat(id).messages.at(-1)?.text), { timeout: 3000, interval: 10 })
        .toBe(true);
      const reply = store.chat(id).messages.at(-1)!;
      expect(reply.creations).toHaveLength(1);
      const creation = reply.creations![0];
      const during = new Store(directory, codec);
      expect(during.chat(id).messages.at(-1)?.creations).toEqual(reply.creations);
      expect(savedRecord(during, creation)).toEqual(creation.record);
      expect(() => service.undoCreation(id, reply.id, creation.id)).toThrow('停止生成');
    } finally {
      service.stop(id);
      await task;
    }
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('stopped');
    const reopened = new Store(directory, codec);
    expect(reopened.chat(id).messages.at(-1)).toEqual(reply);
    expect(savedRecord(reopened, reply.creations![0])).toEqual(reply.creations![0].record);
  });

  it('旧聊天关闭标记不会阻止明确创建请求获得写工具和真实回执', async () => {
    const id = createChat(protocol);
    const before = mock.requests.length;
    Object.assign(store.chat(id), { workspaceAccess: false });
    await service.send(id, '请添加便利贴、课程和笔记 [create-workspace]');
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('complete');
    expect(reply.creations).toHaveLength(3);
    expect(reply.activity?.every((activity) => activity.status === 'done')).toBe(true);
    expect(mock.requests.slice(before).length).toBeGreaterThan(1);
    expect(mock.requests[before].body.tools).toHaveLength(9);
  });

  it('重启后可逐条撤销，原记录保留，撤销状态再次重启仍在', async () => {
    const id = createChat(protocol);
    await service.send(id, '请添加便利贴、课程和笔记 [create-workspace]');
    const reopened = new Store(directory, codec);
    const reopenedService = new ChatService(reopened, () => {});
    const reply = reopened.chat(id).messages.at(-1)!;
    for (const creation of reply.creations!) {
      reopenedService.undoCreation(id, reply.id, creation.id);
      expect(creation.status).toBe('undone');
      expect(savedRecord(reopened, creation)).toBeUndefined();
      expect(() => reopenedService.undoCreation(id, reply.id, creation.id)).not.toThrow();
    }
    const final = new Store(directory, codec);
    expect(
      final
        .chat(id)
        .messages.at(-1)
        ?.creations?.map((creation) => creation.status),
    ).toEqual(['undone', 'undone', 'undone']);
    expect(final.workspace.todos).toEqual([]);
    expect(final.workspace.notes).toEqual([]);
    expect(final.workspace.timetable.courses.map((course) => course.name)).toEqual(['原有课程']);
    expect(final.workspace.timetable.sourceName).toBe('原有课表');
  });

  it('重启后撤销拒绝删除已经编辑的三类记录，回执保持创建时内容', async () => {
    const id = createChat(protocol);
    await service.send(id, '请添加便利贴、课程和笔记 [create-workspace]');
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.creations).toHaveLength(3);
    const originalReceipts = structuredClone(reply.creations!);
    const workspace = new WorkspaceService(
      store,
      () => {},
      () => {},
    );
    for (const creation of reply.creations!) {
      if (creation.kind === 'todo')
        workspace.saveTodo({ ...creation.record, title: '用户修改后的提醒' });
      else if (creation.kind === 'note')
        workspace.saveNote({ ...creation.record, body: '用户补充的重要笔记' });
      else
        workspace.saveTimetable({
          ...store.workspace.timetable,
          courses: store.workspace.timetable.courses.map((course) =>
            course.id === creation.record.id ? { ...course, location: '用户修改的教室' } : course,
          ),
        });
    }
    expect(reply.creations).toEqual(originalReceipts);
    const reopened = new Store(directory, codec);
    const reopenedService = new ChatService(reopened, () => {});
    const edited = structuredClone(reopened.workspace);
    for (const creation of originalReceipts)
      expect(() => reopenedService.undoCreation(id, reply.id, creation.id)).toThrow('已被修改');
    expect(reopened.workspace).toEqual(edited);
    expect(new Store(directory, codec).workspace).toEqual(edited);
    expect(reopened.chat(id).messages.at(-1)?.creations).toEqual(originalReceipts);
  });
});
