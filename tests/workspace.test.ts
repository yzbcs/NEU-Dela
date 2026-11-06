import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../src/main/store';
import { WorkspaceService } from '../src/main/workspace';
import {
  advanceReminder,
  parseWeeks,
  periodTimes,
  weekAt,
  type Todo,
} from '../src/shared/workspace';
import { readTimetable, timetableIcs } from '../src/main/timetable';
import { makeTimetableFixture } from '../scripts/workspace-fixtures';
let directory: string, store: Store, service: WorkspaceService, notifications: Todo[];
const codec = {
  encrypt: (text: string) => Buffer.from(text),
  decrypt: (data: Buffer) => data.toString(),
};
beforeEach(() => {
  mkdirSync(resolve('assets/output/test-state'), { recursive: true });
  directory = mkdtempSync(resolve('assets/output/test-state/workspace-'));
  store = new Store(directory, codec);
  notifications = [];
  service = new WorkspaceService(
    store,
    () => {},
    (todo) => notifications.push({ ...todo }),
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it('到期提醒只发送一次，重启后保留提醒状态，修改时间可重新提醒', () => {
  service.saveTodo({
    title: '报告',
    detail: '补充材料',
    color: 'yellow',
    dueAt: '2026-11-03T01:00:00Z',
    reminder: true,
    repeat: 'none',
    done: false,
  });
  service.tick(new Date('2026-11-03T00:59:00Z'));
  expect(notifications).toHaveLength(0);
  service.tick(new Date('2026-11-03T01:00:00Z'));
  service.tick(new Date('2026-11-03T01:01:00Z'));
  expect(notifications).toHaveLength(1);
  const reopened = new Store(directory, codec);
  new WorkspaceService(
    reopened,
    () => {},
    (todo) => notifications.push(todo),
  ).tick(new Date('2026-11-03T02:00:00Z'));
  expect(notifications).toHaveLength(1);
  service.saveTodo({ ...store.workspace.todos[0], dueAt: '2026-11-03T02:30:00Z' });
  service.tick(new Date('2026-11-03T02:31:00Z'));
  expect(notifications).toHaveLength(2);
});
it('重复事项完成后安排下一次，工作日跳过周末且补发不连发历史通知', () => {
  expect(
    advanceReminder('2026-11-06T01:00:00Z', 'weekdays', new Date('2026-11-06T02:00:00Z')),
  ).toBe('2026-11-09T01:00:00.000Z');
  service.saveTodo({
    title: '每日记录',
    detail: '',
    color: 'blue',
    dueAt: '2026-10-01T01:00:00Z',
    reminder: true,
    repeat: 'daily',
    done: false,
  });
  service.tick(new Date('2026-11-03T01:30:00Z'));
  expect(notifications).toHaveLength(1);
  service.toggleTodo(store.workspace.todos[0].id, new Date('2026-11-03T01:30:00Z'));
  expect(store.workspace.todos[0].dueAt).toBe('2026-11-04T01:00:00.000Z');
  expect(store.workspace.todos[0].done).toBe(false);
});
it.each(['none', 'daily'] as const)(
  '撤销 %s 事项完成恢复时间与提醒状态，并保留后续文字编辑',
  (repeat) => {
    service.saveTodo({
      title: '阅读课程资料',
      detail: '',
      color: 'green',
      dueAt: '2026-11-06T01:00:00Z',
      reminder: true,
      repeat,
      done: false,
    });
    service.tick(new Date('2026-11-06T01:05:00Z'));
    const original = { ...store.workspace.todos[0] };
    service.toggleTodo(original.id, new Date('2026-11-06T01:10:00Z'));
    service.saveTodo({ ...store.workspace.todos[0], title: '阅读资料并整理笔记' });
    service.undoTodo(original.id, {
      done: original.done,
      dueAt: original.dueAt,
      notifiedAt: original.notifiedAt,
    });
    expect(store.workspace.todos[0]).toMatchObject({
      title: '阅读资料并整理笔记',
      done: false,
      dueAt: original.dueAt,
      notifiedAt: original.notifiedAt,
    });
    service.tick(new Date('2026-11-06T01:15:00Z'));
    expect(notifications).toHaveLength(1);
    const reopened = new Store(directory, codec);
    expect(reopened.workspace.todos[0]).toEqual(store.workspace.todos[0]);
  },
);
it('周次支持分段与单双周，学期周数按周一和北京时间计算', () => {
  expect(parseWeeks('研 2周,4-10周')).toEqual([2, 4, 5, 6, 7, 8, 9, 10]);
  expect(parseWeeks('1-8单周')).toEqual([1, 3, 5, 7]);
  expect(parseWeeks('1-8双周')).toEqual([2, 4, 6, 8]);
  expect(() => parseWeeks('0-99')).toThrow();
  expect(weekAt('2026-11-02', '2026-11-08')).toBe(1);
  expect(weekAt('2026-11-02', '2026-11-09')).toBe(2);
});

it('单独更新学期与节次保留当前课程和导入来源，拒绝无效时间后不落盘', () => {
  service.saveTimetable({
    term: '原学期',
    firstMonday: '2026-08-31',
    sourcePath: '/fixture/course.pdf',
    sourceName: '原导入课表.pdf',
    sourceUrl: 'https://example.test/course',
    periods: periodTimes.map(([start, end]) => [start, end]),
    courses: [
      {
        id: 'original-course',
        name: '课程',
        day: 1,
        start: 1,
        end: 2,
        weeks: '1-16',
        location: 'A101',
        teacher: '教师',
        detail: '原有备注',
      },
    ],
  });
  const original = structuredClone(store.workspace.timetable);
  const periods: [string, string][] = periodTimes.map(([start, end]) => [start, end]);
  periods[0] = ['08:20', '09:10'];
  service.updateTimetableSettings({ term: '新学期', firstMonday: '2027-03-01', periods });
  expect(store.workspace.timetable).toEqual({
    ...original,
    term: '新学期',
    firstMonday: '2027-03-01',
    periods,
  });
  const saved = readFileSync(join(directory, 'workspace.json'), 'utf8');
  expect(() =>
    service.updateTimetableSettings({ term: '错误学期', firstMonday: '2027-03-02', periods }),
  ).toThrow('周一');
  expect(() =>
    service.updateTimetableSettings({
      term: '错误学期',
      firstMonday: '2027-03-01',
      periods: periods.map((period, index) => (index === 0 ? ['10:00', '09:00'] : period)),
    }),
  ).toThrow('节次时间');
  expect(readFileSync(join(directory, 'workspace.json'), 'utf8')).toBe(saved);
});
it('笔记编辑使用同一个 ID 并在重启后保留内容', () => {
  const id = service.saveNote({ title: '课程笔记', body: '# 线性代数', category: '课程' });
  service.saveNote({ id, title: '课程笔记', body: '# 线性代数\n\n补充内容', category: '课程' });
  const reopened = new Store(directory, codec);
  expect(reopened.workspace.notes).toHaveLength(1);
  expect(reopened.workspace.notes[0].body).toContain('补充内容');
  expect(readFileSync(join(directory, 'workspace.json'), 'utf8')).toContain('课程笔记');
});

it('删除笔记后迟到的自动保存不会重新创建已删除内容', () => {
  const id = service.saveNote({ title: '待删除', body: '草稿', category: '' });
  service.removeNote(id);
  expect(() => service.saveNote({ id, title: '待删除', body: '迟到的保存', category: '' })).toThrow(
    '已不存在',
  );
  expect(store.workspace.notes).toHaveLength(0);
});
it('笔记本重命名和移除保留正文与置顶，重复保存不改变编辑日期', () => {
  service.saveNotebook('课程');
  const id = service.saveNote({
    title: '课堂备忘',
    body: '- [ ] 整理要点',
    category: '课程',
    pinned: true,
  });
  const note = store.workspace.notes[0];
  note.updatedAt = '2026-11-01T00:00:00.000Z';
  service.saveNote({ id, title: note.title, body: note.body, category: '课程' });
  expect(store.workspace.notes[0]).toMatchObject({ pinned: true, updatedAt: note.updatedAt });
  service.saveNotebook('本学期课程', '课程');
  expect(store.workspace.notes[0]).toMatchObject({
    id,
    category: '本学期课程',
    body: '- [ ] 整理要点',
    pinned: true,
    updatedAt: note.updatedAt,
  });
  expect(() => service.saveNotebook('本学期课程')).toThrow('同名');
  service.removeNotebook('本学期课程');
  const reopened = new Store(directory, codec);
  expect(reopened.workspace.notebooks).toEqual([]);
  expect(reopened.workspace.notes[0]).toMatchObject({
    id,
    category: '',
    body: '- [ ] 整理要点',
    pinned: true,
  });
});
it('真正读取带文字层 PDF，分离星期和合并节次；保存、单双周与 ICS 导出一致', async () => {
  const draft = await readTimetable(makeTimetableFixture());
  expect(draft.courses).toHaveLength(2);
  expect(draft.courses[0]).toMatchObject({
    name: '示例课程',
    day: 1,
    start: 1,
    end: 2,
    weeks: '1-4周',
    location: '1号A101',
  });
  expect(draft.courses[1]).toMatchObject({
    name: '第二课程',
    day: 2,
    start: 3,
    end: 4,
    weeks: '2,4周',
    location: '1号B202',
  });
  service.saveTimetable({
    term: '人工测试学期',
    firstMonday: '2026-11-02',
    sourcePath: draft.sourcePath,
    sourceName: draft.sourceName,
    courses: draft.courses,
  });
  const ics = timetableIcs(store.workspace.timetable);
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(6);
  expect(ics).toContain('DTSTART:20261102T003000Z');
  expect(ics).toContain('SUMMARY:示例课程');
  expect(() =>
    service.saveTimetable({ ...store.workspace.timetable, firstMonday: '2026-11-03' }),
  ).toThrow('周一');
});
