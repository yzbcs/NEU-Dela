import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import {
  campusLinksFor,
  chinaDate,
  dateNumber,
  dayNames,
  parseWeeks,
  periodTimes,
  weekAt,
} from '../shared/workspace';
import type { WorkspaceCreation, WorkspaceSource } from '../shared/types';
import type { Store } from './store';
import { MailService } from './mail';
import { addCoursesInput, todoInput, WorkspaceService } from './workspace';
import { courseConflicts } from '../shared/agenda';
import { resolveResourcePath, textExtensions } from './local-files';

const chunk = {
  offset: z.number().int().min(0).default(0),
  length: z.number().int().min(1).max(30000).default(12000),
};
const schemas = {
  create_todo: todoInput.omit({ id: true, done: true }).extend({
    detail: z.string().max(10000).default(''),
    color: z.enum(['yellow', 'blue', 'green', 'pink']).default('yellow'),
    dueAt: z
      .string()
      .default('')
      .describe('留空表示不设时间；可用带时区的 ISO 时间，或北京时间 YYYY-MM-DDTHH:mm。'),
    reminder: z.boolean().default(false),
    repeat: z.enum(['none', 'daily', 'weekdays', 'weekly']).default('none'),
  }),
  add_courses: addCoursesInput,
  create_note: z.object({
    title: z.string().trim().min(1, '请填写笔记标题').max(300),
    body: z.string().max(1000000),
    category: z.string().trim().max(100).default(''),
  }),
  query_workspace: z.object({
    module: z.enum(['overview', 'timetable', 'todos', 'notes', 'resources', 'mail', 'campus']),
    query: z.string().max(200).default(''),
    date: z.iso.date().optional(),
    status: z.enum(['all', 'pending', 'completed']).default('all'),
    category: z.string().max(100).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  read_workspace_item: z.object({ kind: z.enum(['note', 'todo']), id: z.string(), ...chunk }),
  list_files: z.object({
    resourceId: z.string(),
    path: z.string().default(''),
    offset: z.number().int().min(0).default(0),
  }),
  read_file: z.object({
    resourceId: z.string(),
    path: z.string().default(''),
    page: z.number().int().min(1).default(1),
    ...chunk,
  }),
  list_mail: z.object({
    accountId: z.string(),
    folder: z.string().default('INBOX'),
    page: z.number().int().min(1).max(100).default(1),
  }),
  read_mail: z.object({
    accountId: z.string(),
    folder: z.string().default('INBOX'),
    uid: z.number().int().positive(),
    uidValidity: z.string(),
    ...chunk,
  }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  create_todo:
    '在用户明确要求记录、添加待办或设置提醒时新建一条便利贴，返回实际保存的记录。title 必填；无时间时 dueAt 留空，reminder=false，repeat=none。日期按北京时间解释；提醒或重复必须有明确时间，不猜测缺失时间。不会修改或删除既有便利贴。',
  add_courses:
    '在用户明确要求添加课程时，将 courses 整批追加到当前课表，保留已有课程、学期、节次与来源。每条必须有 name、day（周一=1至周日=7）、start/end（第1至12节）、weeks（如1-16或1-16单周）。先查课表确认学期和自定义节次；不能把任意钟点擅自近似成某节。空课表还需 term 和 firstMonday（第一周周一日期）；缺少这些信息先询问用户。完全相同课程不会重复添加。返回保存后的实际上课时间与冲突提示；不会覆盖整张课表。',
  create_note:
    '在用户明确要求保存、记录或新建笔记时创建笔记，title 和 body 必填，category 可指定笔记本，留空表示未分类。返回实际保存的笔记。不会覆盖或修改已有笔记。',
  query_workspace:
    '查询最新工作台数据。overview 查看各模块数量；timetable 用 date 指定北京时间日期，返回当日实际周次课程和上课时间，不指定则返回全学期安排；todos 可用 status=pending/completed/all 筛选未完成/已完成/全部，用 date 只查当天到期事项（不含无时间或逾期事项）；notes 包含笔记和备忘录，query 搜索标题与正文，category 精确筛选笔记本；resources 查本地资料；mail 查邮箱账号与本地缓存目录；campus 查校园入口。支持 offset、limit，nextOffset 非空时还有结果。先查目录得到真实 ID，再读取正文。',
  read_workspace_item:
    '读取指定笔记或便利贴的完整内容。ID 必须来自工作台查询；长内容按 offset、length 分段读取，返回 nextOffset。',
  list_files:
    '列出本地资料文件夹下某一级目录，不递归扫描。resourceId 来自资料目录，path 是该文件夹内的相对路径；一次返回最多 100 项，使用 offset 继续。',
  read_file:
    '读取已添加的本机文件，或本地资料文件夹内的相对路径。支持 PDF（每次一页）及 UTF-8 文本、Markdown、代码、CSV、JSON。PDF 使用 page 翻页；长文本使用 offset、length，按返回的 nextOffset 继续。不读取网站链接、扫描图片、Word 或未添加到本地资料的路径。',
  list_mail:
    '从已配置邮箱读取一页邮件目录，每页最多 40 封。账号 ID 先查询工作台 mail 模块获得；默认收件箱 INBOX。返回 uidValidity 和每封邮件的 uid，供读取正文。不发送邮件。',
  read_mail:
    '只读指定邮件的纯文本正文和附件名称。accountId、folder、uid、uidValidity 必须来自邮件目录，正文可分段读取；不下载附件、不发送或修改邮件。',
};
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export const workbenchTools: ToolSpec[] = Object.entries(schemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof schemas],
  parameters: z.toJSONSchema(schema, { io: 'input' }),
}));
export function activityLabel(name: string) {
  return (
    (
      {
        create_todo: '添加便利贴',
        add_courses: '添加课程',
        create_note: '创建笔记',
        query_workspace: '查询工作台',
        read_workspace_item: '读取笔记与待办',
        list_files: '查看资料文件夹',
        read_file: '读取资料文件',
        list_mail: '查询邮件目录',
        read_mail: '读取邮件正文',
      } as Record<string, string>
    )[name] ?? '读取工作台'
  );
}
export interface WorkbenchResult {
  data: unknown;
  source?: Omit<WorkspaceSource, 'citation'>;
  detail: string;
  creations?: WorkspaceCreation[];
}
function normalizeTodoTime(value: string) {
  if (!value.trim()) return '';
  const iso = value.trim().replace(' ', 'T');
  if (!z.iso.datetime({ offset: true, local: true }).safeParse(iso).success)
    throw new Error(
      '待办时间需为完整日期与时刻，如北京时间 2026-11-08T20:00 或带时区的 ISO 时间。',
    );
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : iso + '+08:00').toISOString();
}
export function normalizeCreationArguments(name: string, raw: string): unknown {
  const args = JSON.parse(raw || '{}');
  if (name === 'create_todo') {
    const input = schemas.create_todo.parse(args);
    return { ...input, dueAt: normalizeTodoTime(input.dueAt) };
  }
  if (name === 'add_courses') return schemas.add_courses.parse(args);
  if (name === 'create_note') return schemas.create_note.parse(args);
  return args;
}
function textChunk(text: string, offset: number, length: number) {
  return {
    text: text.slice(offset, offset + length),
    totalCharacters: text.length,
    offset,
    nextOffset: offset + length < text.length ? offset + length : null,
  };
}
export class WorkbenchReader {
  private mail: MailService;
  constructor(
    private store: Store,
    private workspace = new WorkspaceService(
      store,
      () => {},
      () => {},
    ),
  ) {
    this.mail = new MailService(store, () => {});
  }
  undoCreation(creation: WorkspaceCreation) {
    if (creation.status === 'undone') return;
    const w = this.store.workspace;
    if (creation.kind === 'todo') {
      const current = w.todos.find((item) => item.id === creation.record.id);
      if (!current) return;
      const fields = ['title', 'detail', 'color', 'dueAt', 'reminder', 'repeat', 'done'] as const;
      if (!fields.every((field) => current[field] === creation.record[field]))
        throw new Error('这条便利贴已被修改，请打开记录后手动处理，原内容已保留。');
      this.workspace.removeTodo(current.id);
    } else if (creation.kind === 'course') {
      const current = w.timetable.courses.find((item) => item.id === creation.record.id);
      if (!current) return;
      const fields = [
        'name',
        'day',
        'start',
        'end',
        'weeks',
        'location',
        'teacher',
        'detail',
      ] as const;
      if (!fields.every((field) => current[field] === creation.record[field]))
        throw new Error('这条课程安排已被修改，请打开课表后手动处理，原内容已保留。');
      this.workspace.removeCourse(current.id);
    } else {
      const current = w.notes.find((item) => item.id === creation.record.id);
      if (!current) return;
      const fields = ['title', 'body', 'category'] as const;
      if (
        !fields.every((field) => current[field] === creation.record[field]) ||
        Boolean(current.pinned) !== Boolean(creation.record.pinned)
      )
        throw new Error('这篇笔记已被修改，请打开笔记后手动处理，原内容已保留。');
      this.workspace.removeNote(current.id);
    }
  }
  summary() {
    const w = this.store.workspace;
    return (
      `当前北京时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。` +
      `当前选择：${w.degree === 'undergrad' ? '本科生' : '研究生'}。工作台中有 ${w.timetable.courses.length} 条课程安排、${w.todos.filter((t) => !t.done).length} 项未完成待办、${w.notes.length} 篇笔记、${w.resources.length} 项本地资料、${w.mailAccounts.length} 个邮箱账号。`
    );
  }
  private resourcePath(id: string, path: string) {
    return resolveResourcePath(this.store.workspace.resources, id, path);
  }
  async execute(name: string, raw: string, signal: AbortSignal): Promise<WorkbenchResult> {
    signal.throwIfAborted();
    const args = JSON.parse(raw || '{}');
    const w = this.store.workspace;
    if (name === 'create_todo') {
      const input = schemas.create_todo.parse(args);
      const id = this.workspace.saveTodo({
        ...input,
        dueAt: normalizeTodoTime(input.dueAt),
        done: false,
      });
      const todo = structuredClone(w.todos.find((item) => item.id === id)!);
      const detail = `已添加便利贴「${todo.title}」`;
      return {
        data: { todo, timeZone: 'Asia/Shanghai' },
        detail,
        creations: [{ id, kind: 'todo', record: todo, status: 'created', detail }],
      };
    }
    if (name === 'create_note') {
      const input = schemas.create_note.parse(args);
      const id = this.workspace.saveNote(input);
      const note = structuredClone(w.notes.find((item) => item.id === id)!);
      const detail = `已创建笔记「${note.title}」`;
      return {
        data: { note },
        detail,
        creations: [{ id, kind: 'note', record: note, status: 'created', detail }],
      };
    }
    if (name === 'add_courses') {
      const added = this.workspace.addCourses(args);
      const table = w.timetable;
      const periods = table.periods ?? periodTimes;
      const requested = [...added.created, ...added.existing];
      const conflicts = courseConflicts(table.courses, periods)
        .filter(({ first, second }) =>
          requested.some((course) => course.id === first.id || course.id === second.id),
        )
        .map(({ first, second }) => ({
          first,
          second,
          weeks: parseWeeks(first.weeks).filter((week) => parseWeeks(second.weeks).includes(week)),
        }))
        .filter(({ weeks }) => weeks.length > 0)
        .map(({ first, second, weeks }) => ({
          first: { id: first.id, name: first.name },
          second: { id: second.id, name: second.name },
          day: first.day,
          weeks,
          startTime: periods[Math.max(first.start, second.start) - 1][0],
          endTime: periods[Math.min(first.end, second.end) - 1][1],
        }));
      const detail =
        `已添加 ${added.created.length} 条课程安排` +
        (added.existing.length ? `，${added.existing.length} 条已存在` : '') +
        (added.duplicatesSkipped ? `，已合并 ${added.duplicatesSkipped} 条重复输入` : '') +
        (conflicts.length ? `；有 ${conflicts.length} 处上课时间重叠，请核对` : '');
      return {
        data: {
          term: table.term,
          firstMonday: table.firstMonday,
          timeZone: 'Asia/Shanghai',
          createdCount: added.created.length,
          existingCount: added.existing.length,
          duplicatesSkipped: added.duplicatesSkipped,
          items: requested.map((course) => ({
            ...course,
            startTime: periods[course.start - 1][0],
            endTime: periods[course.end - 1][1],
          })),
          conflicts,
        },
        detail,
        creations: added.created.map((course) => ({
          id: course.id,
          kind: 'course',
          record: structuredClone(course),
          status: 'created',
          detail:
            `已添加「${course.name}」 · ${dayNames[course.day - 1]} ${periods[course.start - 1][0]}—${periods[course.end - 1][1]} · 周次 ${course.weeks}` +
            conflicts
              .filter(({ first, second }) => first.id === course.id || second.id === course.id)
              .map(
                ({ first, second, weeks }) =>
                  `；与「${first.id === course.id ? second.name : first.name}」在第${weeks.join('、')}周时间重叠`,
              )
              .join(''),
        })),
      };
    }
    if (name === 'query_workspace') {
      const { module, query, date, status, category, offset, limit } =
        schemas.query_workspace.parse(args);
      const match = (value: unknown) =>
        JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
      let items: unknown[];
      let metadata: object = {};
      const source: Omit<WorkspaceSource, 'citation'> = { kind: 'overview', label: '工作台概览' };
      if (module === 'overview')
        return {
          data: {
            today: chinaDate(),
            summary: this.summary(),
            modules: ['timetable', 'todos', 'notes', 'resources', 'mail', 'campus'],
          },
          source,
          detail: '已查看工作台概览',
        };
      if (module === 'timetable') {
        const table = w.timetable;
        const week = date ? weekAt(table.firstMonday, date) : null;
        const day = date ? ((new Date(dateNumber(date)).getUTCDay() + 6) % 7) + 1 : null;
        const periods = table.periods ?? periodTimes;
        items = table.courses
          .filter(
            (c) => match(c) && (!date || (c.day === day && parseWeeks(c.weeks).includes(week!))),
          )
          .map((course) => ({
            ...course,
            startTime: periods[course.start - 1][0],
            endTime: periods[course.end - 1][1],
            ...(date ? { date } : {}),
          }));
        metadata = {
          term: table.term,
          firstMonday: table.firstMonday,
          periods: table.periods ?? periodTimes,
          date,
          week,
          imported: Boolean(table.firstMonday),
          message: table.firstMonday ? undefined : '尚未设置学期首周日期，不能确定某天的课程。',
        };
        source.kind = 'timetable';
        source.label = date ? date + ' 的课表' : '学期课表';
      } else if (module === 'todos') {
        items = w.todos
          .filter(
            (todo) =>
              match(todo) &&
              (status === 'all' || todo.done === (status === 'completed')) &&
              (!date || (todo.dueAt && chinaDate(new Date(todo.dueAt)) === date)),
          )
          .map(({ detail, ...todo }) => ({
            ...todo,
            dueDate: todo.dueAt ? chinaDate(new Date(todo.dueAt)) : null,
            detailPreview: detail.slice(0, 300),
            detailCharacters: detail.length,
          }));
        source.kind = 'todos';
        source.label =
          (date ? date + ' 到期的' : '') +
          { all: '便利贴与待办', pending: '未完成待办', completed: '已完成待办' }[status];
        metadata = { date, status };
      } else if (module === 'notes') {
        items = w.notes
          .filter((note) => match(note) && (category === undefined || note.category === category))
          .map(({ body, ...note }) => ({ ...note, bodyCharacters: body.length }));
        metadata = {
          category,
          notebooks: [
            ...new Set([...w.notebooks, ...w.notes.map((note) => note.category).filter(Boolean)]),
          ],
        };
        source.kind = 'note';
        source.label = '笔记目录';
      } else if (module === 'resources') {
        items = w.resources
          .filter((r) => match({ title: r.title, category: r.category }))
          .map(({ path, ...r }) => ({ ...r, ...(r.kind === 'link' ? { url: path } : {}) }));
        source.kind = 'resource';
        source.label = '本地资料目录';
      } else if (module === 'mail') {
        items = w.mailAccounts
          .map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            cachedInbox: this.mail.cached(a.id, 'INBOX'),
          }))
          .filter(match);
        source.kind = 'mail';
        source.label = '邮箱账号与缓存目录';
      } else {
        items = campusLinksFor(w.degree).filter(match);
        metadata = { degree: w.degree };
        source.kind = 'campus';
        source.label = (w.degree === 'undergrad' ? '本科生' : '研究生') + '校园入口';
      }
      return {
        data: {
          ...metadata,
          readAt: new Date().toISOString(),
          timeZone: 'Asia/Shanghai',
          items: items.slice(offset, offset + limit),
          total: items.length,
          nextOffset: offset + limit < items.length ? offset + limit : null,
        },
        source,
        detail: `已查询${source.label}，共 ${items.length} 项`,
      };
    }
    if (name === 'read_workspace_item') {
      const { kind, id, offset, length } = schemas.read_workspace_item.parse(args);
      const item = (kind === 'note' ? w.notes : w.todos).find((n) => n.id === id);
      if (!item) throw new Error('记录不存在，请先查询工作台目录。');
      const text = 'body' in item ? item.body : item.detail;
      const { body, detail, ...metadata } = { ...item, body: undefined, detail: undefined };
      return {
        data: { ...metadata, ...textChunk(text, offset, length) },
        source: { kind: kind === 'note' ? 'note' : 'todos', id, label: item.title },
        detail: '已读取 ' + item.title,
      };
    }
    if (name === 'list_files') {
      const { resourceId, path, offset } = schemas.list_files.parse(args);
      const target = this.resourcePath(resourceId, path);
      if (target.resource.kind !== 'folder')
        throw new Error('这项资料是单独文件，请使用读取文件。');
      const entries = (await readdir(target.path, { withFileTypes: true })).sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      );
      signal.throwIfAborted();
      return {
        data: {
          entries: entries.slice(offset, offset + 100).map((e) => ({
            name: e.name,
            path: path ? join(path, e.name) : e.name,
            kind: e.isDirectory() ? 'folder' : 'file',
          })),
          total: entries.length,
          nextOffset: offset + 100 < entries.length ? offset + 100 : null,
        },
        source: {
          kind: 'resource',
          id: resourceId,
          label: target.resource.title + (path ? ' / ' + path : ''),
        },
        detail: '已查看文件夹 ' + target.resource.title,
      };
    }
    if (name === 'read_file') {
      const { resourceId, path, page, offset, length } = schemas.read_file.parse(args);
      const target = this.resourcePath(resourceId, path);
      const info = await stat(target.path);
      if (!info.isFile()) throw new Error('请选择文件；文件夹请先列出目录。');
      const extension = extname(target.path).toLowerCase();
      if (info.size > (extension === '.pdf' ? 50 : 8) * 1024 * 1024)
        throw new Error('文件过大：PDF 支持 50 MB 内，文本文件支持 8 MB 内。请拆分后添加。');
      let data: object;
      if (extension === '.pdf') {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
        const task = getDocument({
          data: new Uint8Array(await readFile(target.path, { signal })),
          useSystemFonts: true,
          cMapUrl: join(pdfRoot, 'cmaps') + '/',
          cMapPacked: true,
          standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/',
        });
        const cancel = () => {
          void task.destroy();
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const doc = await task.promise;
          if (page > doc.numPages) throw new Error('PDF 只有 ' + doc.numPages + ' 页。');
          const content = await (await doc.getPage(page)).getTextContent();
          const text = content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('');
          if (!text.trim())
            throw new Error('这一页没有可提取的文字，可能是扫描图片；当前尚未接入 OCR。');
          data = {
            page,
            totalPages: doc.numPages,
            ...textChunk(text, offset, length),
            nextPage: page < doc.numPages ? page + 1 : null,
          };
        } finally {
          signal.removeEventListener('abort', cancel);
          await task.destroy();
        }
      } else {
        if (!textExtensions.has(extension))
          throw new Error('暂不支持读取此格式。请添加 PDF、Markdown、UTF-8 文本或代码文件。');
        data = textChunk(await readFile(target.path, { encoding: 'utf8', signal }), offset, length);
      }
      signal.throwIfAborted();
      return {
        data: { name: basename(target.path), ...data },
        source: { kind: 'resource', id: resourceId, path, label: path || target.resource.title },
        detail:
          '已读取 ' + basename(target.path) + (extension === '.pdf' ? ` · 第 ${page} 页` : ''),
      };
    }
    if (name === 'list_mail') {
      const { accountId, folder, page } = schemas.list_mail.parse(args);
      const account = this.mail.account(accountId);
      const data = await this.mail.list(accountId, folder, page, signal);
      return {
        data: { accountId, folder, ...data },
        source: { kind: 'mail', id: accountId, label: account.name + ' · ' + folder },
        detail: '已读取 ' + account.name + ' 的邮件目录',
      };
    }
    if (name === 'read_mail') {
      const { accountId, folder, uid, uidValidity, offset, length } = schemas.read_mail.parse(args);
      const mail = await this.mail.read(accountId, folder, uid, uidValidity, signal);
      const { text, ...metadata } = mail;
      return {
        data: { ...metadata, ...textChunk(text, offset, length) },
        source: { kind: 'mail', id: accountId, label: mail.subject },
        detail: '已读取邮件：' + mail.subject,
      };
    }
    throw new Error('不支持的工作台操作；请使用已提供的查询、读取或新增工具。');
  }
}
