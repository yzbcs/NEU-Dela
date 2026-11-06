import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../src/main/store';
import { WorkspaceService } from '../src/main/workspace';
import { normalizeCreationArguments, WorkbenchReader, workbenchTools } from '../src/main/workbench';
import { periodTimes } from '../src/shared/workspace';
import type { WorkspaceCreation } from '../src/shared/types';

let directory: string, store: Store, workspace: WorkspaceService, reader: WorkbenchReader;
let changes: number;
const codec = {
  encrypt: (text: string) => Buffer.from(text),
  decrypt: (data: Buffer) => data.toString(),
};
const signal = () => new AbortController().signal;
const execute = (name: string, args: unknown) =>
  reader.execute(name, JSON.stringify(args), signal());
const course = (values: Record<string, unknown> = {}) => ({
  name: '机器学习',
  day: 1,
  start: 1,
  end: 2,
  weeks: '1-16',
  ...values,
});

beforeEach(() => {
  mkdirSync(resolve('assets/output/test-state'), { recursive: true });
  directory = mkdtempSync(resolve('assets/output/test-state/workbench-write-'));
  store = new Store(directory, codec);
  changes = 0;
  workspace = new WorkspaceService(
    store,
    () => changes++,
    () => {},
  );
  reader = new WorkbenchReader(store, workspace);
  store.saveWorkspace();
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('写工具公开必要参数，默认值与等价时区可规范为同一操作', () => {
  expect(workbenchTools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(['create_todo', 'add_courses', 'create_note', 'query_workspace']),
  );
  const noteSchema = workbenchTools.find((tool) => tool.name === 'create_note')!.parameters;
  expect(noteSchema.required).toEqual(expect.arrayContaining(['title', 'body']));
  expect(
    normalizeCreationArguments(
      'create_todo',
      JSON.stringify({ title: ' 明天交作业 ', dueAt: '2026-11-08T20:00' }),
    ),
  ).toEqual(
    normalizeCreationArguments(
      'create_todo',
      JSON.stringify({
        title: '明天交作业',
        detail: '',
        dueAt: '2026-11-08T12:00:00Z',
        color: 'yellow',
        reminder: false,
        repeat: 'none',
      }),
    ),
  );
});

it('新建便利贴返回真实ID、UTC时间与可撤销快照，复用保存刷新并在重启后保留', async () => {
  const result = await execute('create_todo', {
    title: '明天交作业',
    dueAt: '2026-11-08 20:00',
    reminder: true,
  });
  expect(result.source).toBeUndefined();
  expect(result.creations).toHaveLength(1);
  const created = result.creations![0];
  expect(created).toMatchObject({
    kind: 'todo',
    status: 'created',
    record: {
      title: '明天交作业',
      dueAt: '2026-11-08T12:00:00.000Z',
      reminder: true,
      repeat: 'none',
      color: 'yellow',
      done: false,
    },
  });
  expect(created.id).toBe(created.record.id);
  expect((result.data as any).todo.id).toBe(created.record.id);
  expect(changes).toBe(1);
  expect(new Store(directory, codec).workspace.todos[0]).toEqual(created.record);
  const blank = await execute('create_todo', { title: '记下灵感' });
  expect(blank.creations![0].record).toMatchObject({
    dueAt: '',
    reminder: false,
    detail: '',
    done: false,
  });
});

it.each([
  { title: '无时间提醒', reminder: true },
  { title: '无时间重复', repeat: 'daily' },
  { title: '无效日期', dueAt: '2026-02-30T08:00' },
  { title: '缺少时刻', dueAt: '2026-11-08' },
])('缺失或无效提醒时间不写入：$title', async (input) => {
  await expect(execute('create_todo', input)).rejects.toThrow();
  expect(store.workspace.todos).toEqual([]);
  expect(changes).toBe(0);
  expect(new Store(directory, codec).workspace.todos).toEqual([]);
});

it('课程整批追加保留已有元数据，合并完全重复输入并返回实际节次与共同周次冲突', async () => {
  const periods = periodTimes.map(([start, end]): [string, string] => [start, end]);
  periods[0] = ['08:00', '08:40'];
  periods[1] = ['08:50', '09:30'];
  periods[2] = ['09:40', '10:20'];
  const old = {
    ...course({ weeks: '1-4单周' }),
    id: randomUUID(),
    location: 'A101',
    teacher: '原教师',
    detail: '原说明',
  };
  workspace.saveTimetable({
    term: '秋季学期',
    firstMonday: '2026-09-07',
    sourcePath: '/fixture/table.pdf',
    sourceName: '人工课表.pdf',
    sourceUrl: 'https://example.org/course',
    periods,
    courses: [old] as any,
  });
  const before = structuredClone(store.workspace.timetable);
  changes = 0;
  const added = course({ name: '课程讨论', start: 2, end: 3, weeks: '1-4' });
  const result = await execute('add_courses', {
    courses: [{ ...old, weeks: '1,3' }, added, added],
  });
  const data = result.data as any;
  expect(data).toMatchObject({ createdCount: 1, existingCount: 1, duplicatesSkipped: 1 });
  expect(data.items.find((item: any) => item.name === '课程讨论')).toMatchObject({
    startTime: '08:50',
    endTime: '10:20',
  });
  expect(data.conflicts).toHaveLength(1);
  expect(data.conflicts[0]).toMatchObject({ weeks: [1, 3], startTime: '08:50', endTime: '09:30' });
  expect(result.creations).toHaveLength(1);
  expect(result.creations![0].detail).toContain('与「机器学习」在第1、3周时间重叠');
  expect(store.workspace.timetable).toMatchObject({
    ...before,
    courses: [before.courses[0], expect.objectContaining({ name: '课程讨论' })],
  });
  expect(changes).toBe(1);
  const again = await execute('add_courses', { courses: [added] });
  expect(again.creations).toEqual([]);
  expect((again.data as any).existingCount).toBe(1);
  expect(changes).toBe(1);
});

it('相同节次但单双周不同的课程不误报冲突', async () => {
  const result = await execute('add_courses', {
    term: '秋季学期',
    firstMonday: '2026-09-07',
    courses: [course({ weeks: '1-8单周' }), course({ name: '另一门课', weeks: '1-8双周' })],
  });
  expect(result.creations).toHaveLength(2);
  expect((result.data as any).conflicts).toEqual([]);
});

it('空课表信息不足或批中任何课程无效时，前面的有效课程也不落盘', async () => {
  await expect(execute('add_courses', { courses: [course()] })).rejects.toThrow('term');
  await expect(
    execute('add_courses', {
      term: '秋季学期',
      firstMonday: '2026-09-07',
      courses: [course(), course({ name: '无效节次', start: 5, end: 3 })],
    }),
  ).rejects.toThrow('结束节次');
  await expect(
    execute('add_courses', {
      term: '秋季学期',
      firstMonday: '2026-09-07',
      courses: [course(), course({ name: '缺少周次', weeks: '' })],
    }),
  ).rejects.toThrow('周次');
  expect(store.workspace.timetable.courses).toEqual([]);
  expect(store.workspace.timetable.firstMonday).toBe('');
  expect(changes).toBe(0);
  expect(new Store(directory, codec).workspace.timetable.courses).toEqual([]);
});

it('空表可按明确学期初始化，但追加不能修改已有学期或接受非周一首周', async () => {
  await expect(
    execute('add_courses', { term: '秋季学期', firstMonday: '2026-09-08', courses: [course()] }),
  ).rejects.toThrow('周一');
  await execute('add_courses', {
    term: '秋季学期',
    firstMonday: '2026-09-07',
    courses: [course()],
  });
  const before = structuredClone(store.workspace.timetable);
  await expect(
    execute('add_courses', { term: '另一学期', courses: [course({ name: '新课' })] }),
  ).rejects.toThrow('已有学期');
  await expect(
    execute('add_courses', { firstMonday: '2026-09-14', courses: [course({ name: '新课' })] }),
  ).rejects.toThrow('已有学期');
  expect(store.workspace.timetable).toEqual(before);
  expect(new Store(directory, codec).workspace.timetable).toEqual(before);
});

it('创建笔记要求正文，保存原有内容不变并建立指定笔记本', async () => {
  const oldId = workspace.saveNote({ title: '课程笔记', body: '原有正文', category: '' });
  await expect(execute('create_note', { title: '缺正文' })).rejects.toThrow();
  const result = await execute('create_note', {
    title: '课程笔记',
    body: '# 新的理解\n\n- [ ] 补充例子',
    category: '机器学习',
  });
  expect(result.source).toBeUndefined();
  expect(result.creations![0]).toMatchObject({
    kind: 'note',
    record: { title: '课程笔记', body: '# 新的理解\n\n- [ ] 补充例子', category: '机器学习' },
  });
  expect(result.creations![0].record.id).not.toBe(oldId);
  const reopened = new Store(directory, codec);
  expect(reopened.workspace.notes).toHaveLength(2);
  expect(reopened.workspace.notes.find((item) => item.id === oldId)?.body).toBe('原有正文');
  expect(reopened.workspace.notebooks).toContain('机器学习');
});

it('撤销只移除这次新增记录，提醒自动触发不影响撤销；重复撤销无操作', async () => {
  const result = await execute('create_todo', {
    title: '提醒',
    dueAt: '2026-11-08T20:00',
    reminder: true,
  });
  const creation = result.creations![0];
  await execute('create_todo', { title: '随后添加' });
  workspace.tick(new Date('2026-11-08T12:01:00Z'));
  expect(store.workspace.todos.find((item) => item.id === creation.id)?.notifiedAt).not.toBe('');
  reader.undoCreation(creation);
  expect(store.workspace.todos.map((item) => item.title)).toEqual(['随后添加']);
  const before = changes;
  reader.undoCreation(creation);
  expect(changes).toBe(before);
  expect(new Store(directory, codec).workspace.todos.map((item) => item.title)).toEqual([
    '随后添加',
  ]);
});

it('撤销课程保留之后新增的课程、原课表元数据；撤销笔记保留同笔记本其他笔记', async () => {
  const first = await execute('add_courses', {
    term: '秋季学期',
    firstMonday: '2026-09-07',
    courses: [course()],
  });
  await execute('add_courses', { courses: [course({ name: '后加的课程', day: 2 })] });
  reader.undoCreation(first.creations![0]);
  expect(store.workspace.timetable).toMatchObject({
    term: '秋季学期',
    firstMonday: '2026-09-07',
    courses: [expect.objectContaining({ name: '后加的课程' })],
  });
  const note = await execute('create_note', { title: '第一篇', body: '正文', category: '课程' });
  await execute('create_note', { title: '第二篇', body: '正文', category: '课程' });
  reader.undoCreation(note.creations![0]);
  expect(store.workspace.notes.map((item) => item.title)).toEqual(['第二篇']);
  expect(store.workspace.notebooks).toContain('课程');
});

it.each(['todo', 'course', 'note'] as const)(
  '用户编辑后的 %s 拒绝撤销并保留修改；创建快照不随记录一起变',
  async (kind) => {
    let creation: WorkspaceCreation;
    if (kind === 'todo') {
      creation = (await execute('create_todo', { title: '原待办' })).creations![0];
      workspace.saveTodo({ ...store.workspace.todos[0], title: '用户修改后的待办' });
    } else if (kind === 'course') {
      creation = (
        await execute('add_courses', {
          term: '秋季学期',
          firstMonday: '2026-09-07',
          courses: [course()],
        })
      ).creations![0];
      workspace.saveTimetable({
        ...store.workspace.timetable,
        courses: store.workspace.timetable.courses.map((item) => ({
          ...item,
          location: '用户改到B202',
        })),
      });
    } else {
      creation = (await execute('create_note', { title: '原笔记', body: '原正文' })).creations![0];
      workspace.saveNote({ ...store.workspace.notes[0], body: '用户补充后的正文' });
    }
    const before = structuredClone(store.workspace);
    expect(() => reader.undoCreation(creation)).toThrow('已被修改');
    expect(store.workspace).toEqual(before);
    expect(new Store(directory, codec).workspace).toEqual(before);
    if (creation.kind === 'todo') expect(creation.record.title).toBe('原待办');
    if (creation.kind === 'course') expect(creation.record.location).toBe('');
    if (creation.kind === 'note') expect(creation.record.body).toBe('原正文');
  },
);

it('执行前已停止的工具不写入', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    reader.execute('create_todo', JSON.stringify({ title: '不应写入' }), controller.signal),
  ).rejects.toThrow();
  expect(store.workspace.todos).toEqual([]);
  expect(changes).toBe(0);
});
