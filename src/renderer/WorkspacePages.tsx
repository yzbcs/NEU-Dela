import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Plus,
  X,
  Check,
  Clock3,
  Bell,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Upload,
  Download,
  FolderOpen,
  FileText,
  ExternalLink,
  StickyNote,
  CalendarDays,
  Settings2,
  RefreshCw,
} from 'lucide-react';
import { SelectMenu } from './components/SelectMenu';
import { TodoCompletionBar, useTodoCompletion } from './components/TodoCompletion';
import { courseConflicts } from '../shared/agenda';
import './workspace-creations.css';
import {
  addDays,
  campusLinksFor,
  chinaDate,
  dayNames,
  dateNumber,
  parseWeeks,
  periodTimes,
  weekAt,
  type Course,
  type Page,
  type Timetable,
  type Todo,
  type TodoInput,
  type Workspace,
} from '../shared/workspace';

export interface PageProps {
  workspace: Workspace;
  onError: (error: unknown) => void;
  navigate: (page: Page) => void;
}
const api = () => window.dola.workspace;
export function courseColors(courses: Course[]) {
  const colors = new Map<string, CSSProperties>();
  for (const course of courses) {
    const name = course.name.trim();
    if (!colors.has(name)) {
      colors.set(name, { '--course-hue': (210 + colors.size * 137.508) % 360 } as CSSProperties);
    }
  }
  return colors;
}
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="work-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="work-actions">{children}</div>
    </header>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    root.current?.querySelector<HTMLElement>('input,textarea,button')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && root.current) {
        const nodes = [
          ...root.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={root}
        className={'work-modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function niceTime(iso: string) {
  return iso
    ? new Date(iso).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    : '';
}
function localInput(iso: string) {
  if (!iso) return '';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return chinaDate(new Date(iso)) + 'T' + time;
}
export function TodoEditor({
  todo,
  onClose,
  onError,
}: {
  todo?: Todo;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<TodoInput>(
    todo
      ? { ...todo }
      : {
          title: '',
          detail: '',
          color: 'yellow',
          dueAt: '',
          reminder: false,
          repeat: 'none',
          done: false,
        },
  );
  const [saving, setSaving] = useState(false);
  async function save(action: 'save' | 'toggle' | 10 | 60 = 'save') {
    setSaving(true);
    try {
      const next =
        typeof action === 'number'
          ? {
              ...draft,
              dueAt: new Date(
                Math.max(Date.now(), new Date(draft.dueAt).getTime()) + action * 60000,
              ).toISOString(),
            }
          : draft;
      await api().saveTodo(next);
      if (action === 'toggle' && draft.id) await api().toggleTodo(draft.id);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={todo ? '编辑便利贴' : '写一张便利贴'}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="work-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await save();
        }}
      >
        <label>
          要做的事
          <input
            name="todoTitle"
            required
            value={draft.title}
            maxLength={300}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="例如：完成实验报告"
          />
        </label>
        <label>
          补充记录
          <textarea
            name="todoDetail"
            rows={3}
            value={draft.detail}
            onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
            placeholder="写下步骤、材料或一点提醒"
          />
        </label>
        <div className="field-pair">
          <label>
            安排时间（北京时间）
            <input
              name="todoTime"
              type="datetime-local"
              value={localInput(draft.dueAt)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dueAt: e.target.value ? new Date(e.target.value + ':00+08:00').toISOString() : '',
                })
              }
            />
          </label>
          <label>
            重复
            <SelectMenu
              name="todo-repeat"
              label="重复安排"
              value={draft.repeat}
              onChange={(value) => setDraft({ ...draft, repeat: value as Todo['repeat'] })}
              options={[
                { value: 'none', label: '不重复' },
                { value: 'daily', label: '每天' },
                { value: 'weekdays', label: '每个工作日' },
                { value: 'weekly', label: '每周' },
              ]}
            />
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={draft.reminder}
            onChange={(e) => setDraft({ ...draft, reminder: e.target.checked })}
          />
          到时间发送桌面提醒
        </label>
        <div className="color-picker" aria-label="便利贴颜色">
          {(['yellow', 'blue', 'green', 'pink'] as const).map((color) => (
            <button
              type="button"
              key={color}
              className={'color-dot ' + color + (draft.color === color ? ' chosen' : '')}
              aria-label={color}
              onClick={() => setDraft({ ...draft, color })}
            >
              {draft.color === color && <Check size={12} />}
            </button>
          ))}
        </div>
        {draft.repeat !== 'none' && <p className="muted">点击“完成本次”后，会安排下一次。</p>}
        {todo && (
          <div className="todo-quick-actions" aria-label="便利贴快捷操作">
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => void save('toggle')}
            >
              <Check size={14} />
              {draft.done ? '恢复待办' : draft.repeat !== 'none' ? '完成本次' : '完成待办'}
            </button>
            {draft.dueAt &&
              !draft.done &&
              ([10, 60] as const).map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="secondary-button"
                  disabled={saving}
                  title="未到期时从原时间顺延；已到期时从现在起计时。提醒开关保持当前选择。"
                  onClick={() => void save(minutes)}
                >
                  <Clock3 size={14} />
                  推迟{minutes === 10 ? '10分钟' : '1小时'}
                </button>
              ))}
          </div>
        )}
        <div className="work-actions end">
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button className="primary-button" disabled={saving}>
            <Check size={15} />
            保存便利贴
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TodosPage({
  workspace,
  onError,
  navigate,
  focusTodoId,
}: PageProps & { focusTodoId?: string }) {
  const times = workspace.timetable.periods ?? periodTimes;
  const colors = courseColors(workspace.timetable.courses);
  const [editor, setEditor] = useState<Todo | null | undefined>(undefined);
  const [filter, setFilter] = useState('all');
  const completion = useTodoCompletion(workspace.todos, onError);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const todo = workspace.todos.find((item) => item.id === focusTodoId);
    if (todo) setEditor(todo);
  }, [focusTodoId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const today = chinaDate(now),
    week = weekAt(workspace.timetable.firstMonday, today),
    day = ((new Date(dateNumber(today)).getUTCDay() + 6) % 7) + 1;
  const courses =
    week > 0
      ? workspace.timetable.courses
          .filter((course) => {
            try {
              return course.day === day && parseWeeks(course.weeks).includes(week);
            } catch {
              return false;
            }
          })
          .sort((a, b) => a.start - b.start)
      : [];
  const open = workspace.todos.filter((todo) => !todo.done),
    done = workspace.todos.filter((todo) => todo.done);
  const visible = workspace.todos.filter((todo) =>
    filter === 'done'
      ? todo.done
      : filter === 'today'
        ? (!todo.done || completion.retained(todo)) &&
          (!completion.dueAt(todo) || chinaDate(new Date(completion.dueAt(todo))) <= today)
        : filter === 'all'
          ? !todo.done || completion.retained(todo)
          : true,
  );
  return (
    <section className="work-page todos-page">
      <PageHeader
        eyebrow="TODAY, AT YOUR PACE"
        title="今日便利贴"
        subtitle={now.toLocaleDateString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })}
      >
        <button
          className="secondary-button"
          onClick={() => api().testNotification().catch(onError)}
        >
          <Bell size={15} />
          测试提醒
        </button>
        <button className="primary-button" onClick={() => setEditor(null)}>
          <Plus size={16} />
          新便利贴
        </button>
      </PageHeader>
      <div className="home-overview">
        <div>
          <strong>{open.length}</strong>
          <span>件事，慢慢完成</span>
        </div>
        <div>
          <strong>{done.length}</strong>
          <span>件已完成</span>
        </div>
        <button onClick={() => navigate('timetable')}>
          <strong>{courses.length}</strong>
          <span>
            门今日课程 <ChevronRight size={13} />
          </span>
        </button>
        <p>
          <Bell size={16} />
          关闭窗口后会留在后台提醒；从托盘退出或电脑关机后，提醒将停止。
        </p>
      </div>
      <div className="home-body">
        <div className="sticky-section">
          <div className="segment-tabs">
            {[
              ['all', '待完成'],
              ['today', '今日与逾期'],
              ['done', '已完成'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? 'active' : ''}
                aria-label={label}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
                {id === 'done' && done.length > 0 && (
                  <span className="todo-tab-count">{done.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="sticky-grid">
            {visible.map((todo) => (
              <article
                key={todo.id}
                className={
                  'sticky ' + todo.color + (completion.completed(todo) ? ' completed' : '')
                }
                data-todo-id={todo.id}
              >
                <button
                  className={'todo-check ' + (completion.completed(todo) ? 'checked' : '')}
                  aria-label={(completion.completed(todo) ? '恢复 ' : '完成 ') + todo.title}
                  aria-pressed={completion.completed(todo)}
                  disabled={completion.busy.has(todo.id)}
                  title={
                    completion.completed(todo)
                      ? '点击恢复为待完成'
                      : todo.repeat === 'none'
                        ? '标记为已完成'
                        : '完成本次并安排下一次'
                  }
                  onClick={() => void completion.toggle(todo)}
                >
                  <Check size={13} />
                </button>
                <h3>{todo.title}</h3>
                <p>{todo.detail}</p>
                <footer>
                  <span
                    className={
                      completion.completed(todo)
                        ? 'todo-finished-label'
                        : todo.dueAt && new Date(todo.dueAt) < now
                          ? 'overdue'
                          : ''
                    }
                  >
                    {completion.completed(todo) ? (
                      <Check size={12} />
                    ) : todo.reminder ? (
                      <Bell size={12} />
                    ) : (
                      <Clock3 size={12} />
                    )}{' '}
                    {completion.completed(todo)
                      ? completion.retained(todo) && todo.repeat !== 'none'
                        ? '本次已完成 · 下次 ' + niceTime(todo.dueAt)
                        : '已完成'
                      : (todo.dueAt ? niceTime(todo.dueAt) : '随时开始') +
                        (todo.repeat !== 'none' ? ' · 重复' : '')}
                  </span>
                  <button
                    aria-label={'编辑 ' + todo.title}
                    disabled={completion.busy.has(todo.id)}
                    onClick={() => {
                      completion.forget(todo.id);
                      setEditor(todo);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    aria-label={'删除 ' + todo.title}
                    disabled={completion.busy.has(todo.id)}
                    onClick={() => api().removeTodo(todo.id).catch(onError)}
                  >
                    <Trash2 size={13} />
                  </button>
                </footer>
              </article>
            ))}
            {!visible.length && (
              <button className="blank-sticky" onClick={() => setEditor(null)}>
                <Plus size={25} />
                <strong>{filter === 'done' ? '完成的事会留在这里' : '写下今天的一件小事'}</strong>
                <span>待办、灵感、截止时间，都可以。</span>
              </button>
            )}
          </div>
          {filter !== 'done' && (
            <TodoCompletionBar
              count={completion.count}
              busy={completion.busy.size > 0}
              onDismiss={completion.dismiss}
            />
          )}
        </div>
        <aside className="today-panel">
          <h3>
            <CalendarDays size={17} />
            今天的课程
          </h3>
          {!workspace.timetable.firstMonday ? (
            <p>导入课表后，今天要去哪里就一目了然。</p>
          ) : !courses.length ? (
            <p>今天没有已安排的课程，给自己留一点空间。</p>
          ) : (
            courses.map((course) => (
              <div
                className="today-course course-tint"
                key={course.id}
                style={colors.get(course.name.trim())}
              >
                <small>
                  {times[course.start - 1][0]} — {times[course.end - 1][1]}
                </small>
                <strong>{course.name}</strong>
                <span>{course.location || '地点待补充'}</span>
              </div>
            ))
          )}
          <button className="text-button" onClick={() => navigate('timetable')}>
            查看完整课表 <ChevronRight size={13} />
          </button>
          <hr />
          <h3>
            <FolderOpen size={17} />
            随手继续
          </h3>
          <button className="text-button" onClick={() => navigate('library')}>
            打开资料与笔记 <ChevronRight size={13} />
          </button>
          <button className="text-button" onClick={() => navigate('campus')}>
            校园常用入口 <ChevronRight size={13} />
          </button>
        </aside>
      </div>
      {editor !== undefined && (
        <TodoEditor
          todo={editor ?? undefined}
          onClose={() => setEditor(undefined)}
          onError={onError}
        />
      )}
    </section>
  );
}
export function TimetablePage({
  workspace,
  onError,
  focusCourseId,
  focusCourseDate,
  onOpenNote,
  onOpenLibrary,
}: PageProps & {
  focusCourseId?: string;
  focusCourseDate?: string;
  onOpenNote: (id: string) => void;
  onOpenLibrary: (category: string, tab: 'notes' | 'files') => void;
}) {
  const table = workspace.timetable;
  const colors = courseColors(table.courses);
  const times = table.periods ?? periodTimes;
  const [draft, setDraft] = useState<Timetable | null>(null);
  const [editCourseId, setEditCourseId] = useState<string>();
  const courseEditor = useRef<HTMLTableElement>(null);
  const [rawText, setRawText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState<'pdf' | 'web' | null>(null);
  const current = weekAt(table.firstMonday);
  const [week, setWeek] = useState(Math.max(1, Math.min(60, current || 1)));
  const [detail, setDetail] = useState<Course | null>(null);
  const [creatingNote, setCreatingNote] = useState(false);
  const editing = Boolean(draft);
  useEffect(() => {
    if (!editing || !editCourseId) return;
    const row = [...(courseEditor.current?.rows ?? [])].find(
      (item) => item.dataset.courseEdit === editCourseId,
    );
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector('input')?.focus();
  }, [editing, editCourseId]);
  useEffect(() => {
    const course = table.courses.find((item) => item.id === focusCourseId);
    if (!course) return;
    const weeks = parseWeeks(course.weeks);
    const requested = focusCourseDate ? weekAt(table.firstMonday, focusCourseDate) : current;
    setWeek(
      weeks.includes(requested)
        ? requested
        : (weeks.find((item) => item >= requested) ?? weeks.at(-1)!),
    );
    setDetail(course);
  }, [focusCourseId, focusCourseDate]);
  const detailDate =
    detail && table.firstMonday ? addDays(table.firstMonday, (week - 1) * 7 + detail.day - 1) : '';
  async function createCourseNote() {
    if (!detail) return;
    setCreatingNote(true);
    try {
      const id = await api().saveNote({
        title: `${detail.name} · ${detailDate || '课程笔记'}`,
        category: detail.name.trim(),
        body: [
          `# ${detail.name}`,
          `${detailDate ? detailDate + ' · ' : ''}${dayNames[detail.day - 1]} · ${times[detail.start - 1][0]}—${times[detail.end - 1][1]}`,
          `地点：${detail.location || '待补充'}\n教师：${detail.teacher || '待补充'}`,
          '## 课堂要点\n',
          '## 我的理解\n',
          '## 课后问题\n\n- [ ] 整理需要确认的问题',
        ].join('\n\n'),
      });
      onOpenNote(id);
    } catch (error) {
      onError(error);
    } finally {
      setCreatingNote(false);
    }
  }
  async function importCourses(kind: 'pdf' | 'web') {
    setLoading(kind);
    try {
      const imported =
        kind === 'web' ? await api().importGraduateTimetable() : await api().importTimetable();
      if (imported) {
        setDraft({
          ...table,
          sourceName: imported.sourceName,
          sourcePath: imported.sourcePath,
          sourceUrl: imported.sourceUrl,
          term: imported.term || table.term,
          firstMonday: imported.term && imported.term !== table.term ? '' : table.firstMonday,
          courses: imported.courses,
        });
        setWarnings(imported.warnings);
        setRawText(imported.text);
      }
    } catch (e) {
      onError(e);
    } finally {
      setLoading(null);
    }
  }
  function updateCourse(index: number, field: keyof Course, value: string | number) {
    setDraft((old) =>
      old
        ? {
            ...old,
            courses: old.courses.map((course, i) =>
              i === index ? { ...course, [field]: value } : course,
            ),
          }
        : null,
    );
  }
  const visible = table.courses.filter((course) => {
    try {
      return parseWeeks(course.weeks).includes(week);
    } catch {
      return false;
    }
  });
  const conflicts = courseConflicts(visible, times);
  return (
    <section className="work-page">
      <PageHeader
        eyebrow="YOUR WEEK, IN VIEW"
        title="我的课表"
        subtitle={table.term || '把一周的安排，整理成自己的节奏。'}
      >
        <button
          className="secondary-button"
          disabled={!table.courses.length}
          onClick={() => api().exportTimetable().catch(onError)}
        >
          <Download size={15} />
          导出日历
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setDraft(structuredClone(table));
            setWarnings([]);
            setRawText('');
          }}
        >
          <Pencil size={15} />
          编辑课表
        </button>
        <button
          className="secondary-button"
          disabled={loading !== null}
          onClick={() => void importCourses('web')}
        >
          <ExternalLink size={15} />
          {loading === 'web' ? '等待网页导入' : '网页导入'}
        </button>
        <button
          className="primary-button"
          disabled={loading !== null}
          onClick={() => void importCourses('pdf')}
        >
          <Upload size={15} />
          {loading === 'pdf' ? '正在读取 PDF' : '导入 PDF'}
        </button>
      </PageHeader>
      <div className="calendar-toolbar">
        <div className="week-switch">
          <button aria-label="上一周" disabled={week <= 1} onClick={() => setWeek(week - 1)}>
            <ChevronLeft size={16} />
          </button>
          <strong>第 {week} 周</strong>
          <button aria-label="下一周" disabled={week >= 60} onClick={() => setWeek(week + 1)}>
            <ChevronRight size={16} />
          </button>
          <button
            className="text-button"
            onClick={() => setWeek(Math.max(1, Math.min(60, current || 1)))}
          >
            回到本周
          </button>
        </div>
        <span>
          {table.firstMonday
            ? `${addDays(table.firstMonday, (week - 1) * 7)} 至 ${addDays(table.firstMonday, (week - 1) * 7 + 6)}`
            : '请先设置第一周的周一日期'}
        </span>
        {table.sourcePath && (
          <button
            className="text-button"
            onClick={() => api().openLocal(table.sourcePath).catch(onError)}
          >
            <FileText size={14} />
            原始 PDF
          </button>
        )}
        {table.sourceUrl && (
          <button
            className="text-button"
            onClick={() => api().openWebsite(table.sourceUrl!).catch(onError)}
          >
            <ExternalLink size={14} />
            学校原页面
          </button>
        )}
      </div>
      {!table.courses.length && (
        <div className="inline-info">
          可以从研究生系统网页读取，或导入带文字层的
          PDF。网页导入需在弹出的学校窗口中登录并进入个人课表，再点击“读取当前课表”；导入后可逐条核对修正。
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="course-conflicts" role="status">
          <strong>本周有 {conflicts.length} 组课程时间重叠</strong>
          {conflicts.map(({ first, second }) => (
            <p key={first.id + ':' + second.id}>
              {dayNames[first.day - 1]}：
              <button className="text-button" onClick={() => setDetail(first)}>
                {first.name}
              </button>
              与
              <button className="text-button" onClick={() => setDetail(second)}>
                {second.name}
              </button>
              ，请核对安排。
            </p>
          ))}
        </div>
      )}
      <div className="calendar-scroll">
        <div className="calendar-grid">
          <div className="calendar-times">
            <div className="calendar-day-label">节次</div>
            {times.map(([start, end], i) => (
              <div key={start}>
                <strong>{i + 1}</strong>
                <small>
                  {start}
                  <br />
                  {end}
                </small>
              </div>
            ))}
          </div>
          {dayNames.map((day, index) => (
            <div key={day} className="calendar-day">
              <div className="calendar-day-label">
                {day}
                {table.firstMonday && (
                  <small>{addDays(table.firstMonday, (week - 1) * 7 + index).slice(5)}</small>
                )}
              </div>
              <div className="calendar-day-courses">
                {visible
                  .filter((course) => course.day === index + 1)
                  .map((course) => (
                    <button
                      key={course.id}
                      className="calendar-course course-tint"
                      style={{
                        ...colors.get(course.name.trim()),
                        gridRow: `${course.start} / ${course.end + 1}`,
                      }}
                      onClick={() => setDetail(course)}
                    >
                      <strong>{course.name}</strong>
                      <span>{course.location}</span>
                      <small>
                        {course.start}-{course.end} 节
                      </small>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="course-detail">
            <p>
              {detailDate && `${detailDate} · `}
              {dayNames[detail.day - 1]} · 第 {detail.start}—{detail.end} 节
            </p>
            <p>
              时间：{times[detail.start - 1][0]}—{times[detail.end - 1][1]}
            </p>
            <p>周次：{detail.weeks}</p>
            <p>地点：{detail.location || '待补充'}</p>
            <p>教师：{detail.teacher || '待补充'}</p>
            <pre>{detail.detail}</pre>
            <button
              className="secondary-button"
              onClick={() => {
                setEditCourseId(detail.id);
                setDraft(structuredClone(table));
                setWarnings([]);
                setRawText('');
                setDetail(null);
              }}
            >
              <Pencil size={14} />
              编辑课程
            </button>
          </div>
          <div className="course-learning">
            <h3>这门课的学习记录</h3>
            <p>笔记本和资料分类使用课程名“{detail.name.trim()}”。</p>
            <div className="work-actions">
              <button
                className="primary-button"
                disabled={creatingNote}
                onClick={() => void createCourseNote()}
              >
                <Plus size={15} />
                {creatingNote ? '正在创建' : '新建本次课程笔记'}
              </button>
              <button
                className="secondary-button"
                onClick={() => onOpenLibrary(detail.name.trim(), 'notes')}
              >
                <FileText size={15} />
                课程笔记{' '}
                {workspace.notes.filter((note) => note.category === detail.name.trim()).length}
              </button>
              <button
                className="secondary-button"
                onClick={() => onOpenLibrary(detail.name.trim(), 'files')}
              >
                <FolderOpen size={15} />
                课程资料{' '}
                {workspace.resources.filter((item) => item.category === detail.name.trim()).length}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {draft && (
        <Modal title="核对并保存课表" onClose={() => setDraft(null)} wide>
          <div className="work-form">
            <div className="field-pair">
              <label>
                学期名称
                <input
                  name="term"
                  value={draft.term}
                  onChange={(e) => setDraft({ ...draft, term: e.target.value })}
                  placeholder="例如：2026—2027 秋季学期"
                />
              </label>
              <label>
                第一周的周一
                <input
                  name="firstMonday"
                  type="date"
                  value={draft.firstMonday}
                  onChange={(e) => setDraft({ ...draft, firstMonday: e.target.value })}
                />
              </label>
            </div>
            {warnings.map((warning) => (
              <p key={warning} className="inline-info">
                {warning}
              </p>
            ))}
            <div className="course-editor-scroll">
              <table ref={courseEditor} className="course-editor">
                <thead>
                  <tr>
                    <th>课程</th>
                    <th>星期</th>
                    <th>开始节</th>
                    <th>结束节</th>
                    <th>周次</th>
                    <th>地点</th>
                    <th>教师</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.courses.map((course, index) => (
                    <tr key={course.id} data-course-edit={course.id}>
                      <td>
                        <input
                          aria-label={'课程名称 ' + index}
                          value={course.name}
                          onChange={(e) => updateCourse(index, 'name', e.target.value)}
                        />
                      </td>
                      <td>
                        <SelectMenu
                          name={'course-day-' + index}
                          label="上课星期"
                          value={String(course.day)}
                          options={dayNames.map((day, i) => ({ value: String(i + 1), label: day }))}
                          onChange={(v) => updateCourse(index, 'day', Number(v))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={course.start}
                          onChange={(e) => updateCourse(index, 'start', Number(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={course.end}
                          onChange={(e) => updateCourse(index, 'end', Number(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          value={course.weeks}
                          onChange={(e) => updateCourse(index, 'weeks', e.target.value)}
                          placeholder="1-16单周"
                        />
                      </td>
                      <td>
                        <input
                          value={course.location}
                          onChange={(e) => updateCourse(index, 'location', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={course.teacher}
                          onChange={(e) => updateCourse(index, 'teacher', e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={'删除课程 ' + index}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              courses: draft.courses.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="text-button"
              onClick={() =>
                setDraft({
                  ...draft,
                  courses: [
                    ...draft.courses,
                    {
                      id: crypto.randomUUID(),
                      name: '',
                      day: 1,
                      start: 1,
                      end: 2,
                      weeks: '1-16',
                      location: '',
                      teacher: '',
                      detail: '',
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              添加课程
            </button>
            <details className="pdf-text">
              <summary>调整节次时间（按校区或学期设置）</summary>
              <div className="period-editor">
                {(draft.periods ?? periodTimes).map(([start, end], index) => (
                  <label key={index}>
                    第 {index + 1} 节
                    <div className="field-pair">
                      {[start, end].map((value, part) => (
                        <input
                          key={part}
                          type="time"
                          aria-label={`第${index + 1}节${part === 0 ? '开始' : '结束'}`}
                          value={value}
                          onChange={(event) => {
                            const periods = (draft.periods ?? periodTimes).map(
                              (row) => [...row] as [string, string],
                            );
                            periods[index][part] = event.target.value;
                            setDraft({ ...draft, periods });
                          }}
                        />
                      ))}
                    </div>
                  </label>
                ))}
              </div>
            </details>
            {rawText && (
              <details className="pdf-text">
                <summary>查看导入原文</summary>
                <pre>{rawText}</pre>
              </details>
            )}
            <div className="work-actions end">
              <button className="secondary-button" onClick={() => setDraft(null)}>
                取消
              </button>
              <button
                className="primary-button"
                onClick={async () => {
                  try {
                    await api().saveTimetable(draft);
                    setDraft(null);
                    setWeek(Math.max(1, Math.min(60, weekAt(draft.firstMonday))));
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <Check size={15} />
                确认保存课表
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function CampusPage({ workspace, onError }: PageProps) {
  const degreeLabel = workspace.degree === 'undergrad' ? '本科生' : '研究生';
  const links = campusLinksFor(workspace.degree);
  return (
    <section className="work-page campus-page">
      <PageHeader
        eyebrow="CONNECTED TO CAMPUS"
        title="校园入口"
        subtitle={degreeLabel + '常用服务入口，在系统浏览器完成学校统一身份认证。'}
      />
      <div className="segment-tabs" role="tablist" aria-label="学生类型">
        <button
          className={workspace.degree === 'undergrad' ? 'active' : ''}
          role="tab"
          aria-selected={workspace.degree === 'undergrad'}
          onClick={() => api().setDegree('undergrad').catch(onError)}
        >
          本科生
        </button>
        <button
          className={workspace.degree === 'graduate' ? 'active' : ''}
          role="tab"
          aria-selected={workspace.degree === 'graduate'}
          onClick={() => api().setDegree('graduate').catch(onError)}
        >
          研究生
        </button>
      </div>
      {(['degree', 'common'] as const).map((group) => (
        <section
          className="campus-section"
          key={group}
          aria-label={group === 'degree' ? degreeLabel + '专属服务' : '通用服务'}
        >
          <h2 className="campus-section-title">
            {group === 'degree' ? degreeLabel + '专属服务' : '通用服务'}
          </h2>
          <div
            className={
              'campus-link-grid ' + (group === 'degree' ? 'campus-role-grid' : 'campus-common-grid')
            }
            data-campus-group={group}
          >
            {links
              .filter((link) =>
                group === 'common' ? link.audience === 'all' : link.audience !== 'all',
              )
              .map((link) => (
                <button
                  key={link.url}
                  className="campus-link-card"
                  onClick={() => api().openWebsite(link.url).catch(onError)}
                >
                  <ExternalLink size={19} />
                  <strong>{link.title}</strong>
                  <span>{link.subtitle}</span>
                  <small>{link.url}</small>
                </button>
              ))}
          </div>
        </section>
      ))}
      <div className="inline-info">
        {workspace.degree === 'undergrad'
          ? '本科教务系统的校外访问可能需要学校 WebVPN 或 OpenVPN，请以学校通知为准。'
          : '研究生选课与部分管理业务可能分属新旧系统，可从一号通选择对应入口。'}
        学校系统的访问权限由你的统一认证账号决定。
      </div>
    </section>
  );
}
