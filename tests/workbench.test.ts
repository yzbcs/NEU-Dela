import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { Store } from '../src/main/store';
import { ChatService } from '../src/main/chat';
import { WorkbenchReader } from '../src/main/workbench';
import { WorkspaceService } from '../src/main/workspace';
import { fixtureToolResults, startMockServer } from '../scripts/mock-server';
import { makeTimetableFixture } from '../scripts/workspace-fixtures';
import type { Protocol } from '../src/shared/types';

let mock: Awaited<ReturnType<typeof startMockServer>>;
let directory: string, store: Store, service: ChatService, reader: WorkbenchReader;
const signal = () => new AbortController().signal;
beforeAll(async () => {
  mock = await startMockServer({ delayMs: 0 });
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  mkdirSync(resolve('assets/output/test-state'), { recursive: true });
  directory = mkdtempSync(resolve('assets/output/test-state/workbench-'));
  store = new Store(directory, {
    encrypt: (text) => Buffer.from(text),
    decrypt: (data) => data.toString(),
  });
  service = new ChatService(store, () => {});
  reader = new WorkbenchReader(store);
  store.workspace.notes = [
    {
      id: 'note-fixture',
      title: '学习率笔记',
      category: '机器学习',
      body: '真正的笔记正文：梯度下降需要检查学习率。fixture-private-key',
      updatedAt: new Date().toISOString(),
    },
  ];
  store.workspace.todos = [
    {
      id: 'todo-fixture',
      title: '准备课程报告',
      detail: '报告需要补充课程案例',
      color: 'yellow',
      dueAt: '',
      reminder: false,
      repeat: 'none',
      done: false,
      notifiedAt: '',
      createdAt: new Date().toISOString(),
    },
  ];
  const course = {
    id: 'course-fixture',
    name: '示例课程',
    day: 3,
    start: 1,
    end: 2,
    weeks: '1,3',
    location: 'A101',
    teacher: '示例教师',
    detail: '',
  };
  store.workspace.timetable = {
    term: '测试学期',
    firstMonday: '2026-11-02',
    sourcePath: '',
    sourceName: '',
    courses: [course, { ...course, id: 'course-even', name: '另一门课程', weeks: '2,4' }],
  };
  const folder = join(directory, 'project');
  mkdirSync(folder);
  mkdirSync(join(folder, 'subdir'));
  writeFileSync(join(folder, 'study.md'), '项目记录：计划本周完成数据清洗。');
  writeFileSync(join(folder, 'subdir', 'analysis.py'), 'print("fixture analysis")\n');
  makeTimetableFixture(join(directory, 'study.pdf'));
  store.workspace.resources = [
    {
      id: 'file-fixture',
      title: '课程样例.pdf',
      kind: 'file',
      path: join(directory, 'study.pdf'),
      category: '课程',
      addedAt: new Date().toISOString(),
    },
    {
      id: 'folder-fixture',
      title: '项目文件夹',
      kind: 'folder',
      path: folder,
      category: '项目',
      addedAt: new Date().toISOString(),
    },
  ];
  store.saveWorkspace();
});
afterEach(() => {
  service.stopAll();
  rmSync(directory, { recursive: true, force: true });
});
function provider(protocol: Protocol = 'openai-responses') {
  return store.saveProvider({
    name: '工作台本地验证',
    protocol,
    baseUrl: mock.url + '/v1',
    model: 'dola-mock-tools',
    apiKey: 'fixture-private-key',
  });
}

it('按真实日期、星期与单双周查课程，并返回可继续读取的笔记目录', async () => {
  const first = await reader.execute(
    'query_workspace',
    JSON.stringify({ module: 'timetable', date: '2026-11-04' }),
    signal(),
  );
  expect((first.data as any).items.map((i: any) => i.name)).toEqual(['示例课程']);
  const next = await reader.execute(
    'query_workspace',
    JSON.stringify({ module: 'timetable', date: '2026-11-11' }),
    signal(),
  );
  expect((next.data as any).items.map((i: any) => i.name)).toEqual(['另一门课程']);
  const notes = await reader.execute(
    'query_workspace',
    JSON.stringify({ module: 'notes', query: '梯度下降' }),
    signal(),
  );
  expect((notes.data as any).items[0]).toMatchObject({ id: 'note-fixture', title: '学习率笔记' });
  expect(JSON.stringify(notes.data)).not.toContain('fixture-private-key');
  const part = await reader.execute(
    'read_workspace_item',
    JSON.stringify({ kind: 'note', id: 'note-fixture', offset: 0, length: 8 }),
    signal(),
  );
  expect(part.data).toMatchObject({
    text: store.workspace.notes[0].body.slice(0, 8),
    nextOffset: 8,
  });
});

it('读取关联文件夹及其子目录里的真实文件，不读取未关联路径或二进制格式', async () => {
  const list = await reader.execute(
    'list_files',
    JSON.stringify({ resourceId: 'folder-fixture' }),
    signal(),
  );
  expect((list.data as any).entries.map((i: any) => i.name)).toEqual(['subdir', 'study.md']);
  const file = await reader.execute(
    'read_file',
    JSON.stringify({ resourceId: 'folder-fixture', path: 'subdir/analysis.py' }),
    signal(),
  );
  expect((file.data as any).text).toContain('fixture analysis');
  await expect(
    reader.execute(
      'read_file',
      JSON.stringify({ resourceId: 'folder-fixture', path: '../study.pdf' }),
      signal(),
    ),
  ).rejects.toThrow('相对路径');
  await expect(
    reader.execute('read_file', JSON.stringify({ resourceId: 'not-associated' }), signal()),
  ).rejects.toThrow('资料不存在');
  writeFileSync(join(directory, 'report.docx'), 'fixture unsupported');
  store.workspace.resources.push({
    ...store.workspace.resources[0],
    id: 'unsupported',
    path: join(directory, 'report.docx'),
  });
  await expect(
    reader.execute('read_file', JSON.stringify({ resourceId: 'unsupported' }), signal()),
  ).rejects.toThrow('暂不支持');
});
it('待办按完成状态及北京时间日期筛选，课程返回当天实际上课时间', async () => {
  const original = store.workspace.todos[0];
  store.workspace.todos = [
    { ...original, id: 'pending-today', dueAt: '2026-11-03T17:00:00Z' },
    { ...original, id: 'done-today', dueAt: '2026-11-04T03:00:00Z', done: true },
    { ...original, id: 'pending-tomorrow', dueAt: '2026-11-04T17:00:00Z' },
    { ...original, id: 'undated' },
  ];
  const query = (args: object) => reader.execute('query_workspace', JSON.stringify(args), signal());
  const pending = await query({ module: 'todos', status: 'pending', date: '2026-11-04' });
  expect((pending.data as any).items.map((item: any) => item.id)).toEqual(['pending-today']);
  const done = await query({ module: 'todos', status: 'completed', date: '2026-11-04' });
  expect((done.data as any).items.map((item: any) => item.id)).toEqual(['done-today']);
  const allPending = await query({ module: 'todos', status: 'pending', limit: 1 });
  expect(allPending.data).toMatchObject({ total: 3, nextOffset: 1, timeZone: 'Asia/Shanghai' });
  const remaining = await query({ module: 'todos', status: 'pending', offset: 1 });
  expect((remaining.data as any).items.map((item: any) => item.id)).toEqual([
    'pending-tomorrow',
    'undated',
  ]);
  const course = await query({ module: 'timetable', date: '2026-11-04' });
  expect((course.data as any).items[0]).toMatchObject({
    date: '2026-11-04',
    startTime: '08:30',
    endTime: '10:10',
    location: 'A101',
  });
  const noClass = await query({ module: 'timetable', date: '2026-11-05' });
  expect(noClass.data).toMatchObject({ imported: true, items: [] });
  store.workspace.timetable.firstMonday = '';
  const noTable = await query({ module: 'timetable', date: '2026-11-05' });
  expect(noTable.data).toMatchObject({ imported: false, items: [] });
  expect((noTable.data as any).message).toContain('尚未设置');
});

it.each<Protocol>(['openai-responses', 'openai-chat', 'anthropic'])(
  '%s 对话重新查询已编辑笔记、清单和待办状态，并按指定日期读取课程',
  async (protocol) => {
    const p = provider(protocol);
    const workspace = new WorkspaceService(
      store,
      () => {},
      () => {},
    );
    const noteId = workspace.saveNote({
      title: '实验备忘',
      category: '课程',
      body: '原计划：周五交报告。\n- [ ] 准备数据',
      pinned: true,
    });
    const id = store.createChat(p.id);
    await service.send(
      id,
      '[study-check] 请根据 2026-11-04 的课程、未完成便利贴和备忘录，整理我的安排。',
    );
    const first = store.chat(id).messages.at(-1)!;
    expect(first.state).toBe('complete');
    expect(first.text).toContain('原计划：周五交报告');
    expect(first.text).toContain('准备课程报告');
    expect(first.text).toContain('08:30');
    workspace.saveNote({
      id: noteId,
      title: '实验备忘',
      category: '课程',
      body: '最新安排：周六交报告。\n- [x] 准备数据\n- [ ] 写结论',
    });
    store.workspace.todos[0].done = true;
    store.saveWorkspace();
    const before = mock.requests.length;
    await service.send(
      id,
      '[study-check] 内容刚更新了，再核对 2026-11-11 的课程、未完成便利贴和备忘录。',
    );
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('complete');
    expect(reply.text).toContain('最新安排：周六交报告');
    expect(reply.text).toContain('- [x] 准备数据');
    expect(reply.text).toContain('- [ ] 写结论');
    expect(reply.text).not.toContain('原计划：周五交报告');
    expect(reply.text).not.toContain('准备课程报告');
    expect(reply.text).toContain('另一门课程');
    expect(reply.text).not.toContain('示例课程');
    expect(reply.sources?.some((source) => source.id === noteId)).toBe(true);
    const results = fixtureToolResults(mock.requests.slice(before).at(-1)!.body);
    const queries = results.filter((result) => result.name === 'query_workspace');
    expect(
      queries.some(
        (result) => result.payload.data.status === 'pending' && result.payload.data.total === 0,
      ),
    ).toBe(true);
    const notes = await reader.execute(
      'query_workspace',
      JSON.stringify({ module: 'notes', category: '课程', query: '写结论' }),
      signal(),
    );
    expect((notes.data as any).items).toHaveLength(1);
    expect((notes.data as any).items[0]).toMatchObject({
      id: noteId,
      pinned: true,
      category: '课程',
    });
  },
);
it('AI 查询校园入口跟随本科或研究生选择，通用服务保持可用', async () => {
  store.workspace.degree = 'undergrad';
  const undergraduate = await reader.execute(
    'query_workspace',
    JSON.stringify({ module: 'campus' }),
    signal(),
  );
  const undergraduateNames = (undergraduate.data as any).items.map((item: any) => item.title);
  expect(undergraduateNames).toContain('本科教务系统');
  expect(undergraduateNames).not.toContain('研究生综合管理');
  expect(undergraduateNames).toContain('学生云邮箱');
  store.workspace.degree = 'graduate';
  const graduate = await reader.execute(
    'query_workspace',
    JSON.stringify({ module: 'campus' }),
    signal(),
  );
  const graduateNames = (graduate.data as any).items.map((item: any) => item.title);
  expect(graduateNames).toContain('研究生综合管理');
  expect(graduateNames).not.toContain('本科教务系统');
  expect(graduateNames).toContain('一号通门户');
  expect(reader.summary()).toContain('当前选择：研究生');
});

it('实际提取关联中文 PDF 的指定页和文字分段', async () => {
  const result = await reader.execute(
    'read_file',
    JSON.stringify({ resourceId: 'file-fixture' }),
    signal(),
  );
  expect(result.data).toMatchObject({ page: 1, totalPages: 1, nextPage: null });
  expect((result.data as any).text).toContain('示例课程');
  await expect(
    reader.execute('read_file', JSON.stringify({ resourceId: 'file-fixture', page: 2 }), signal()),
  ).rejects.toThrow('只有 1 页');
});

it.each<Protocol>(['openai-responses', 'openai-chat', 'anthropic'])(
  '%s 工具轮次真实读取笔记、待办、PDF 和文件夹，并保存引用',
  async (protocol) => {
    const p = provider(protocol);
    const id = store.createChat(p.id);
    const before = mock.requests.length;
    await service.send(id, '[workbench] 请读取我的工作台资料');
    const reply = store.chat(id).messages.at(-1)!;
    expect(reply.state).toBe('complete');
    expect(reply.text).toContain('真正的笔记正文');
    expect(reply.text).toContain('报告需要补充课程案例');
    expect(reply.text).toContain('示例课程');
    expect(reply.text).toContain('项目记录：计划本周完成数据清洗');
    expect(reply.activity).toHaveLength(10);
    expect(reply.activity!.every((step) => step.status === 'done')).toBe(true);
    expect(reply.sources!.some((source) => source.id === 'file-fixture')).toBe(true);
    const requests = mock.requests.slice(before);
    expect(requests).toHaveLength(4);
    expect(reply.usage).toEqual({ input: 168, output: 320 });
    const last = requests.at(-1)!.body;
    expect(fixtureToolResults(last).filter((r) => r.name === 'read_file')).toHaveLength(2);
    expect(JSON.stringify(requests.map((r) => r.body))).not.toContain('fixture-private-key');
    expect(JSON.stringify(requests.map((r) => r.body))).not.toContain(directory);
    if (protocol === 'openai-chat')
      expect(last.messages.find((m: any) => m.tool_calls?.length).reasoning_content).toBe(
        'fixture opaque continuation',
      );
    if (protocol === 'openai-responses')
      expect(last.input.find((m: any) => m.type === 'reasoning').encrypted_content).toBe(
        'fixture-opaque-reasoning',
      );
    if (protocol === 'anthropic')
      expect(
        last.messages.find((m: any) => m.role === 'assistant' && Array.isArray(m.content))
          .content[0],
      ).toMatchObject({ type: 'thinking', signature: 'fixture-signature' });
    const reopened = new Store(directory, {
      encrypt: (text) => Buffer.from(text),
      decrypt: (data) => data.toString(),
    });
    expect(reopened.chat(id).messages.at(-1)?.sources).toEqual(reply.sources);
    expect(reopened.chat(id).messages.at(-1)?.activity).toEqual(reply.activity);
  },
);

it('关闭工作台访问时只进行普通对话，不读取和发送模块内容', async () => {
  const p = provider();
  const id = store.createChat(p.id);
  const before = mock.requests.length;
  await service.send(id, '[workbench]', false);
  expect(mock.requests).toHaveLength(before + 1);
  expect(mock.requests.at(-1)!.body.tools).toBeUndefined();
  expect(mock.requests.at(-1)!.body.instructions).toContain('未启用工作台访问');
  expect(store.chat(id).workspaceAccess).toBe(false);
  expect(store.chat(id).messages.at(-1)?.activity).toBeUndefined();
});

it('文件不存在时将真实失败交回模型和界面，不伪造来源', async () => {
  const p = provider();
  const id = store.createChat(p.id);
  await service.send(id, '[tool-error]');
  const reply = store.chat(id).messages.at(-1)!;
  expect(reply.state).toBe('complete');
  expect(reply.text).toContain('资料不存在');
  expect(reply.activity?.[0].status).toBe('error');
  expect(reply.sources).toBeUndefined();
});

it('工具参数尚未完整传输就断流时不执行读取', async () => {
  const p = provider();
  const id = store.createChat(p.id);
  await service.send(id, '[workbench] [disconnect]');
  const reply = store.chat(id).messages.at(-1)!;
  expect(reply.state).toBe('error');
  expect(reply.activity).toBeUndefined();
});

it('服务拒绝工具时给出可操作提示，不自动重复请求；关闭后可以普通聊天', async () => {
  const p = provider();
  const id = store.createChat(p.id);
  const before = mock.requests.length;
  await service.send(id, '[tools-unsupported]');
  expect(mock.requests).toHaveLength(before + 1);
  expect(store.chat(id).messages.at(-1)?.error).toContain('关闭“工作台访问”');
  await service.send(id, '继续普通聊天', false);
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
});

it('连续查询有明确轮次上限，之后直接完成回复', async () => {
  const p = provider();
  const id = store.createChat(p.id);
  const before = mock.requests.length;
  await service.send(id, '[tool-loop]');
  expect(mock.requests).toHaveLength(before + 7);
  expect(store.chat(id).messages.at(-1)?.activity).toHaveLength(6);
  expect(store.chat(id).messages.at(-1)?.state).toBe('complete');
});

it('工具轮次中停止生成会终止续接，不再发起后续读取', async () => {
  const p = provider();
  const id = store.createChat(p.id);
  const before = mock.requests.length;
  const pending = service.send(id, '[workbench] [slow]');
  const deadline = Date.now() + 5000;
  while (
    (mock.requests.length < before + 2 ||
      !store
        .chat(id)
        .messages.at(-1)
        ?.activity?.some((step) => step.status === 'done')) &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(
    store
      .chat(id)
      .messages.at(-1)
      ?.activity?.some((step) => step.status === 'done'),
  ).toBe(true);
  service.stop(id);
  await pending;
  expect(store.chat(id).messages.at(-1)?.state).toBe('stopped');
  expect(service.busy(id)).toBe(false);
  const count = mock.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(mock.requests).toHaveLength(count);
});
