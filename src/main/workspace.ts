import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store';
import {
  advanceReminder,
  dateNumber,
  parseWeeks,
  type Todo,
  type TodoCompletion,
  type TodoInput,
  type Timetable,
  type TimetableSettings,
  type Course,
  type Workspace,
} from '../shared/workspace';

export const todoInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, '请填写待办事项').max(300),
  detail: z.string().max(10000),
  color: z.enum(['yellow', 'blue', 'green', 'pink']),
  dueAt: z.union([z.literal(''), z.string().datetime()]),
  reminder: z.boolean(),
  repeat: z.enum(['none', 'daily', 'weekdays', 'weekly']),
  done: z.boolean(),
});
export const courseInput = z.object({
  id: z.string(),
  name: z.string().trim().min(1, '课程名称不能为空'),
  day: z.number().int().min(1).max(7),
  start: z.number().int().min(1).max(12),
  end: z.number().int().min(1).max(12),
  weeks: z.string(),
  location: z.string(),
  teacher: z.string(),
  detail: z.string(),
});

export const addCoursesInput = z.object({
  courses: z
    .array(
      courseInput.omit({ id: true }).extend({
        location: z.string().default(''),
        teacher: z.string().default(''),
        detail: z.string().default(''),
      }),
    )
    .min(1, '请提供至少一条课程安排'),
  term: z.string().trim().min(1, '请填写学期名称').optional(),
  firstMonday: z.iso.date('请选择有效的学期首周日期').optional(),
});

export class WorkspaceService {
  constructor(
    readonly store: Store,
    private changed: () => void,
    private notify: (todo: Todo) => void,
  ) {}
  setDegree(value: Workspace['degree']) {
    this.store.workspace.degree = z.enum(['undergrad', 'graduate']).parse(value);
    this.store.workspace.degreeConfirmed = true;
    this.save();
  }
  saveTodo(raw: TodoInput) {
    const input = todoInput.parse(raw);
    if ((input.reminder || input.repeat !== 'none') && !input.dueAt)
      throw new Error('提醒或重复事项需要设置时间');
    const old = input.id
      ? this.store.workspace.todos.find((item) => item.id === input.id)
      : undefined;
    if (input.id && !old) throw new Error('这条便利贴已不存在');
    const sameDue = old?.dueAt === input.dueAt && old?.reminder === input.reminder;
    const todo: Todo = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: old?.createdAt ?? new Date().toISOString(),
      notifiedAt: sameDue ? old.notifiedAt : '',
    };
    this.store.workspace.todos = [
      todo,
      ...this.store.workspace.todos.filter((item) => item.id !== todo.id),
    ];
    this.save();
    return todo.id;
  }
  toggleTodo(id: string, now = new Date()) {
    const todo = this.store.workspace.todos.find((item) => item.id === id);
    if (!todo) throw new Error('便利贴不存在');
    if (!todo.done && todo.repeat !== 'none' && todo.dueAt) {
      todo.dueAt = advanceReminder(todo.dueAt, todo.repeat, now);
      todo.notifiedAt = '';
    } else todo.done = !todo.done;
    this.save();
  }
  undoTodo(id: string, previous: TodoCompletion) {
    const todo = this.store.workspace.todos.find((item) => item.id === id);
    if (!todo) throw new Error('便利贴不存在');
    const completion = z
      .object({
        done: z.boolean(),
        dueAt: z.union([z.literal(''), z.string().datetime()]),
        notifiedAt: z.union([z.literal(''), z.string().datetime()]),
      })
      .parse(previous);
    Object.assign(todo, completion);
    this.save();
  }
  removeTodo(id: string) {
    this.store.workspace.todos = this.store.workspace.todos.filter((item) => item.id !== id);
    this.save();
  }
  tick(now = new Date()) {
    let dirty = false;
    for (const todo of this.store.workspace.todos) {
      if (
        !todo.done &&
        todo.reminder &&
        todo.dueAt &&
        !todo.notifiedAt &&
        new Date(todo.dueAt).getTime() <= now.getTime()
      ) {
        this.notify(todo);
        todo.notifiedAt = now.toISOString();
        dirty = true;
      }
    }
    if (dirty) this.save();
  }
  saveTimetable(raw: Timetable) {
    const timetable = z
      .object({
        term: z.string().trim().min(1, '请填写学期名称'),
        firstMonday: z.iso.date('请选择有效的第一周周一日期'),
        periods: z
          .array(
            z.tuple([
              z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
              z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            ]),
          )
          .length(12)
          .optional(),
        sourcePath: z.string(),
        sourceName: z.string(),
        sourceUrl: z.string().url().optional(),
        courses: z.array(courseInput),
      })
      .parse(raw);
    if (new Date(dateNumber(timetable.firstMonday)).getUTCDay() !== 1)
      throw new Error('学期起始日期必须为周一');
    if (timetable.periods)
      for (let i = 0; i < timetable.periods.length; i++) {
        const [start, end] = timetable.periods[i];
        if (end <= start || (i > 0 && start < timetable.periods[i - 1][1]))
          throw new Error('节次时间应依次递增，且结束时间晚于开始时间');
      }
    for (const course of timetable.courses) {
      if (course.end < course.start) throw new Error('结束节次不能早于开始节次');
      parseWeeks(course.weeks);
    }
    this.store.workspace.timetable = timetable;
    this.save();
  }
  updateTimetableSettings(input: TimetableSettings) {
    this.saveTimetable({
      ...this.store.workspace.timetable,
      term: input.term,
      firstMonday: input.firstMonday,
      periods: input.periods ?? this.store.workspace.timetable.periods,
    });
  }
  addCourses(raw: unknown) {
    const input = addCoursesInput.parse(raw);
    const table = this.store.workspace.timetable;
    if (
      (input.term && table.term && input.term !== table.term) ||
      (input.firstMonday && table.firstMonday && input.firstMonday !== table.firstMonday)
    )
      throw new Error('当前课表已有学期设置。新增课程不会更改学期或首周日期，请先核对现有课表。');
    const term = table.term || input.term;
    const firstMonday = table.firstMonday || input.firstMonday;
    if (!term || !firstMonday)
      throw new Error('请先提供学期名称 term 和第一周周一日期 firstMonday，再添加课程。');

    const created: Course[] = [],
      existing: Course[] = [];
    let duplicatesSkipped = 0;
    const fields = ['name', 'day', 'start', 'end', 'location', 'teacher', 'detail'] as const;
    for (const course of input.courses) {
      const weeks = parseWeeks(course.weeks);
      const found = [...table.courses, ...created].find(
        (item) =>
          fields.every((field) => item[field] === course[field]) &&
          parseWeeks(item.weeks).join(',') === weeks.join(','),
      );
      if (found) {
        if (
          created.some((item) => item.id === found.id) ||
          existing.some((item) => item.id === found.id)
        )
          duplicatesSkipped++;
        else existing.push(found);
      } else created.push({ ...course, id: randomUUID() });
    }
    // Validate the complete candidate before replacing any state or writing to disk.
    if (created.length)
      this.saveTimetable({ ...table, term, firstMonday, courses: [...table.courses, ...created] });
    return { created, existing, duplicatesSkipped };
  }
  removeCourse(id: string) {
    const table = this.store.workspace.timetable;
    this.saveTimetable({ ...table, courses: table.courses.filter((course) => course.id !== id) });
  }
  saveNote(raw: unknown) {
    const input = z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().trim().min(1, '请填写笔记标题').max(300),
        body: z.string().max(1000000),
        category: z.string().trim().max(100),
        pinned: z.boolean().optional(),
      })
      .parse(raw);
    const id = input.id ?? randomUUID();
    const old = this.store.workspace.notes.find((note) => note.id === id);
    if (input.id && !old) throw new Error('这篇笔记已不存在，请新建记录');
    const pinned = input.pinned ?? old?.pinned ?? false;
    const contentChanged = !old || old.title !== input.title || old.body !== input.body;
    if (!contentChanged && old.category === input.category && Boolean(old.pinned) === pinned)
      return id;
    const note = {
      ...input,
      pinned,
      id,
      updatedAt: contentChanged ? new Date().toISOString() : old.updatedAt,
    };
    if (input.category && !this.store.workspace.notebooks.includes(input.category))
      this.store.workspace.notebooks.push(input.category);
    this.store.workspace.notes = [
      note,
      ...this.store.workspace.notes.filter((item) => item.id !== id),
    ];
    this.save();
    return id;
  }
  saveNotebook(name: string, previousName?: string) {
    const next = z.string().trim().min(1, '请填写笔记本名称').max(100).parse(name);
    const names = new Set([
      ...this.store.workspace.notebooks,
      ...this.store.workspace.notes.map((note) => note.category).filter(Boolean),
    ]);
    if (next !== previousName && names.has(next)) throw new Error('已经有同名笔记本');
    if (previousName) {
      if (!names.has(previousName)) throw new Error('笔记本已不存在');
      names.delete(previousName);
      for (const note of this.store.workspace.notes)
        if (note.category === previousName) note.category = next;
    }
    names.add(next);
    this.store.workspace.notebooks = [...names];
    this.save();
  }
  removeNotebook(name: string) {
    this.store.workspace.notebooks = this.store.workspace.notebooks.filter((item) => item !== name);
    for (const note of this.store.workspace.notes) if (note.category === name) note.category = '';
    this.save();
  }
  removeNote(id: string) {
    this.store.workspace.notes = this.store.workspace.notes.filter((item) => item.id !== id);
    this.save();
  }
  save() {
    this.store.saveWorkspace();
    this.changed();
  }
}
