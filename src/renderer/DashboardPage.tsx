import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  GraduationCap,
  Mail,
  Plus,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { chinaDate, dateNumber, weekAt, type Todo } from '../shared/workspace';
import { courseColors, PageHeader, TodoEditor, type PageProps } from './WorkspacePages';
import { TodoCompletionBar, useTodoCompletion } from './components/TodoCompletion';
import { buildAgenda, coursesOnDate } from '../shared/agenda';
import './agenda.css';
import './dashboard-design.css';

const clock = (date: Date) =>
  date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
function deadline(value: string, now: Date) {
  if (!value) return '未设时间';
  const date = new Date(value);
  const day = chinaDate(date) === chinaDate(now) ? '今天' : chinaDate(date).slice(5);
  return `${date < now ? '已逾期 · ' : ''}${day} ${clock(date)}`;
}

export function DashboardPage({
  workspace,
  onError,
  navigate,
  onOpenNote,
  onOpenCourse,
}: PageProps & {
  onOpenNote: (id: string) => void;
  onOpenCourse?: (id: string, date: string) => void;
}) {
  const [now, setNow] = useState(new Date());
  const [editor, setEditor] = useState<Todo | null | undefined>();
  const [agendaDate, setAgendaDate] = useState(chinaDate());
  const completion = useTodoCompletion(workspace.todos, onError);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const table = workspace.timetable;
  const today = chinaDate(now);
  const week = weekAt(table.firstMonday, today);
  const time = clock(now);
  const colors = courseColors(table.courses);
  const courses = coursesOnDate(table, today);
  const agenda = buildAgenda(workspace, now);
  const selectedDay = agenda.days.find((day) => day.date === agendaDate) ?? agenda.days[0];
  const ongoing = agenda.days[0].items.find(
    (item) => item.kind === 'course' && item.time <= time && time < item.endTime,
  );
  const upcoming = agenda.days
    .flatMap((day) => day.items.map((item) => ({ date: day.date, item })))
    .find(({ date, item }) =>
      item.kind === 'todo'
        ? new Date(item.todo.dueAt) >= now
        : new Date(`${date}T${item.time}:00+08:00`) >= now,
    );
  const nextAction = ongoing ? { date: today, item: ongoing } : upcoming;
  const nextDayLabel = nextAction
    ? nextAction.date === today
      ? '今天'
      : nextAction.date === agenda.days[1].date
        ? '明天'
        : new Date(dateNumber(nextAction.date)).toLocaleDateString('zh-CN', {
            timeZone: 'UTC',
            month: 'long',
            day: 'numeric',
            weekday: 'short',
          })
    : '';
  const openCourse = (id: string, date: string) =>
    onOpenCourse ? onOpenCourse(id, date) : navigate('timetable');
  function editTodo(todo: Todo) {
    completion.forget(todo.id);
    setEditor(todo);
  }
  const pending = workspace.todos
    .filter((todo) => !todo.done)
    .sort(
      (a, b) =>
        (a.dueAt || '9999').localeCompare(b.dueAt || '9999') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const overdue = pending.filter((todo) => todo.dueAt && new Date(todo.dueAt) < now).length;
  const visibleTodos = workspace.todos
    .filter((todo) => !todo.done || completion.retained(todo))
    .sort(
      (a, b) =>
        (completion.dueAt(a) || '9999').localeCompare(completion.dueAt(b) || '9999') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const notes = [...workspace.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const stats = [
    {
      page: 'todos',
      label: '待办事项',
      value: pending.length,
      hint: overdue ? `${overdue} 件已逾期` : '查看全部便利贴',
      Icon: StickyNote,
      tone: 'yellow',
    },
    {
      page: 'timetable',
      label: '今日课程',
      value: courses.length,
      hint: table.firstMonday ? '查看本周安排' : '添加你的课程安排',
      Icon: CalendarDays,
      tone: 'blue',
    },
    {
      page: 'library',
      label: '我的笔记',
      value: notes.length,
      hint: `${workspace.resources.length} 项本地资料`,
      Icon: FileText,
      tone: 'green',
    },
    {
      page: 'mail',
      label: '邮箱账号',
      value: workspace.mailAccounts.length,
      hint: workspace.mailAccounts.length ? '已连接，前往收件箱' : '连接学校或常用邮箱',
      Icon: Mail,
      tone: 'violet',
    },
  ] as const;
  return (
    <section className="work-page dashboard-page">
      <PageHeader
        eyebrow="把今天安排得从容一点"
        title="工作台首页"
        subtitle={
          now.toLocaleDateString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }) + (week > 0 && week <= 60 ? ` · 第 ${week} 周` : '')
        }
      >
        <button className="primary-button" onClick={() => setEditor(null)}>
          <Plus size={16} />
          新便利贴
        </button>
      </PageHeader>

      <section
        className="dashboard-focus"
        aria-label="接下来"
        data-focus-kind={nextAction?.item.kind ?? 'empty'}
      >
        <span className="dashboard-focus-icon">
          {nextAction?.item.kind === 'course' ? (
            <CalendarDays size={24} />
          ) : nextAction ? (
            <Clock3 size={24} />
          ) : (
            <Sparkles size={24} />
          )}
        </span>
        <div className="dashboard-focus-copy">
          <span className="dashboard-focus-label">
            {ongoing ? '正在进行' : nextAction ? '接下来' : '留一点空间给自己'}
          </span>
          <strong>
            {nextAction
              ? nextAction.item.kind === 'course'
                ? nextAction.item.course.name
                : nextAction.item.todo.title
              : table.firstMonday
                ? '未来七天暂时没有定时安排'
                : '把第一份安排带进来'}
          </strong>
          <p>
            {nextAction
              ? nextAction.item.kind === 'course'
                ? `${nextDayLabel} ${nextAction.item.time}—${nextAction.item.endTime} · ${nextAction.item.course.location || '地点待补充'}`
                : `${nextDayLabel} ${nextAction.item.time} · ${nextAction.item.todo.reminder ? '已设提醒' : '待办安排'}`
              : table.firstMonday
                ? '可以先记下一件事，或看看还没安排时间的待办。'
                : '导入你的课表，下一门课和待办安排就会出现在这里。'}
          </p>
        </div>
        <button
          className="dashboard-focus-action"
          onClick={() => {
            if (nextAction?.item.kind === 'course')
              openCourse(nextAction.item.course.id, nextAction.date);
            else if (nextAction?.item.kind === 'todo') editTodo(nextAction.item.todo);
            else if (!table.firstMonday) navigate('timetable');
            else setEditor(null);
          }}
        >
          {nextAction?.item.kind === 'course'
            ? '查看课程'
            : nextAction
              ? '查看待办'
              : !table.firstMonday
                ? '设置课表'
                : '记一件事'}
          <ChevronRight size={15} />
        </button>
      </section>

      <div className="dashboard-stats">
        {stats.map(({ page, label, value, hint, Icon, tone }) => (
          <button
            key={page}
            className="dashboard-stat"
            data-dashboard-stat={page}
            onClick={() => navigate(page)}
          >
            <span className={'dashboard-stat-icon ' + tone}>
              <Icon size={18} />
            </span>
            <strong>{value}</strong>
            <span className="dashboard-stat-label">{label}</span>
            <small>
              {hint}
              <ArrowUpRight size={12} />
            </small>
          </button>
        ))}
      </div>

      <div className="dashboard-main-grid">
        <section className="dashboard-card dashboard-agenda" aria-label="未来七天日程">
          <header className="dashboard-card-header">
            <h2>
              <CalendarDays size={17} />
              未来七天
            </h2>
            <button className="text-button" onClick={() => navigate('timetable')}>
              完整课表
              <ChevronRight size={13} />
            </button>
          </header>
          <div className="agenda-days" aria-label="选择日程日期">
            {agenda.days.map((day, index) => (
              <button
                key={day.date}
                data-agenda-date={day.date}
                aria-pressed={selectedDay.date === day.date}
                aria-label={`${day.date}，${day.courses.length} 门课，${day.todos.length} 项待办`}
                onClick={() => setAgendaDate(day.date)}
              >
                <span>
                  {index === 0
                    ? '今天'
                    : index === 1
                      ? '明天'
                      : new Date(dateNumber(day.date)).toLocaleDateString('zh-CN', {
                          timeZone: 'UTC',
                          weekday: 'short',
                        })}
                </span>
                <strong>{day.date.slice(5).replace('-', '/')}</strong>
                <small>
                  {day.courses.length} 课 · {day.todos.length} 待办
                </small>
              </button>
            ))}
          </div>
          <p className="agenda-date-label">
            {selectedDay.date}
            {selectedDay.week > 0 && selectedDay.week <= 60 ? ` · 第 ${selectedDay.week} 周` : ''}
            {!table.firstMonday && ' · 设置学期首周后显示课程'}
          </p>
          {selectedDay.conflicts.length > 0 && (
            <div className="agenda-conflict" role="status">
              <AlertTriangle size={15} />
              <div>
                {selectedDay.conflicts.map(({ first, second }) => (
                  <p key={`${first.id}-${second.id}`}>
                    课程时间重叠：{first.name} 与 {second.name}。请在课表中核对。
                  </p>
                ))}
              </div>
            </div>
          )}
          {selectedDay.items.length ? (
            <div
              key={selectedDay.date}
              className="agenda-items"
              data-agenda-selected={selectedDay.date}
            >
              {selectedDay.items.map((item) =>
                item.kind === 'course' ? (
                  <button
                    key={'course:' + item.course.id}
                    className="agenda-item agenda-course course-tint"
                    style={colors.get(item.course.name.trim())}
                    data-agenda-course={item.course.id}
                    onClick={() => openCourse(item.course.id, selectedDay.date)}
                  >
                    <time>
                      {item.time}—{item.endTime}
                    </time>
                    <span>
                      <strong>{item.course.name}</strong>
                      <small>
                        {selectedDay.date === today && (
                          <span
                            className={
                              'agenda-course-status ' +
                              (item.time <= time && time < item.endTime ? 'current' : '')
                            }
                          >
                            {time < item.time
                              ? '待上课'
                              : time < item.endTime
                                ? '上课中'
                                : '已结束'}
                          </span>
                        )}
                        {item.course.location || '地点待补充'} · 第 {item.course.start}—
                        {item.course.end} 节
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    key={'todo:' + item.todo.id}
                    className="agenda-item"
                    data-agenda-todo={item.todo.id}
                    onClick={() => editTodo(item.todo)}
                  >
                    <time>{item.time}</time>
                    <span>
                      <strong>{item.todo.title}</strong>
                      <small className={item.overdue ? 'agenda-overdue' : ''}>
                        {item.overdue ? '已逾期' : '待办'}
                        {item.todo.repeat !== 'none' ? ' · 本次时间' : ''}
                        {item.todo.reminder ? ' · 已设提醒' : ''}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ),
              )}
            </div>
          ) : (
            <div key={selectedDay.date} className="agenda-empty">
              <CalendarDays size={25} />
              <strong>{table.firstMonday ? '这天的时间，由你安排' : '从一张课表开始'}</strong>
              <p>
                {table.firstMonday
                  ? '这天没有已安排的课程或定时待办，可以留给自己的计划。'
                  : '这天没有定时待办；设置学期首周后可查看课程。'}
              </p>
              {!table.firstMonday && (
                <button className="text-button" onClick={() => navigate('timetable')}>
                  设置课表
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          )}
          <div className="agenda-backlogs">
            {[
              { title: '此前逾期', todos: agenda.earlier },
              { title: '未设时间', todos: agenda.undated },
            ]
              .filter((group) => group.todos.length > 0)
              .map((group) => (
                <details
                  key={group.title}
                  className="agenda-backlog"
                  data-agenda-backlog={group.title}
                >
                  <summary>
                    {group.title} · {group.todos.length} 项待办
                  </summary>
                  <div className="agenda-backlog-list">
                    {group.todos.map((todo) => (
                      <button key={todo.id} className="agenda-item" onClick={() => editTodo(todo)}>
                        <time>
                          {todo.dueAt
                            ? `${chinaDate(new Date(todo.dueAt)).slice(5)} ${clock(new Date(todo.dueAt))}`
                            : '待安排'}
                        </time>
                        <span>
                          <strong>{todo.title}</strong>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                </details>
              ))}
          </div>
        </section>

        <section className="dashboard-card dashboard-todos" aria-label="待办概览">
          <header className="dashboard-card-header">
            <h2>
              <StickyNote size={17} />
              我的待办
            </h2>
            <button className="text-button" onClick={() => navigate('todos')}>
              全部便利贴
              <ChevronRight size={13} />
            </button>
          </header>
          {visibleTodos.length ? (
            <div className="dashboard-todo-list">
              {visibleTodos.slice(0, 4).map((todo) => (
                <div
                  key={todo.id}
                  className={'dashboard-todo' + (completion.completed(todo) ? ' completed' : '')}
                  data-todo-id={todo.id}
                >
                  <button
                    className="dashboard-todo-check"
                    aria-label={
                      (completion.completed(todo) ? '恢复待办 ' : '完成待办 ') + todo.title
                    }
                    aria-pressed={completion.completed(todo)}
                    disabled={completion.busy.has(todo.id)}
                    onClick={() => void completion.toggle(todo)}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    className="dashboard-todo-content"
                    aria-label={'编辑待办 ' + todo.title}
                    disabled={completion.busy.has(todo.id)}
                    onClick={() => {
                      completion.forget(todo.id);
                      setEditor(todo);
                    }}
                  >
                    <strong>{todo.title}</strong>
                    <small
                      className={
                        completion.completed(todo)
                          ? 'todo-finished-label'
                          : todo.dueAt && new Date(todo.dueAt) < now
                            ? 'overdue'
                            : ''
                      }
                    >
                      {completion.completed(todo) ? <Check size={11} /> : <Clock3 size={11} />}
                      {completion.completed(todo)
                        ? completion.retained(todo) && todo.repeat !== 'none'
                          ? '本次已完成 · 下次 ' + deadline(todo.dueAt, now)
                          : '已完成'
                        : deadline(todo.dueAt, now)}
                    </small>
                  </button>
                </div>
              ))}
              {visibleTodos.length > 4 && (
                <button className="text-button" onClick={() => navigate('todos')}>
                  查看其余 {visibleTodos.length - 4} 件事
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          ) : (
            <div className="dashboard-empty">
              <Check size={26} />
              <strong>暂时没有未完成的事</strong>
              <p>作业、灵感、截止时间，先写下今天的一件小事。</p>
              <button className="text-button" onClick={() => setEditor(null)}>
                写一张便利贴
                <Plus size={13} />
              </button>
            </div>
          )}
          <TodoCompletionBar
            count={completion.count}
            busy={completion.busy.size > 0}
            onDismiss={completion.dismiss}
          />
        </section>
      </div>

      <div className="dashboard-grid dashboard-secondary-grid">
        <section className="dashboard-card dashboard-notes" aria-label="最近笔记">
          <header className="dashboard-card-header">
            <h2>
              <FileText size={17} />
              最近笔记
            </h2>
            <button className="text-button" onClick={() => navigate('library')}>
              全部资料
              <ChevronRight size={13} />
            </button>
          </header>
          {notes.length ? (
            notes.slice(0, 3).map((note) => (
              <button
                key={note.id}
                className="dashboard-note"
                aria-label={'打开笔记 ' + note.title}
                onClick={() => onOpenNote(note.id)}
              >
                <span className="dashboard-note-icon">
                  <FileText size={17} />
                </span>
                <span>
                  <strong>{note.title}</strong>
                  <small>
                    {note.category || '未分类'} · {chinaDate(new Date(note.updatedAt)).slice(5)}{' '}
                    更新
                  </small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            ))
          ) : (
            <div className="dashboard-empty compact">
              <FileText size={24} />
              <strong>留一个地方，放下想法</strong>
              <p>课程笔记、论文阅读、项目记录，按自己的方式整理。</p>
              <button className="text-button" onClick={() => navigate('library')}>
                打开资料与笔记
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </section>

        <section className="dashboard-card dashboard-shortcuts" aria-label="常用入口">
          <header className="dashboard-card-header">
            <h2>
              <Sparkles size={17} />
              随手继续
            </h2>
          </header>
          <button className="dashboard-shortcut" onClick={() => navigate('chat')}>
            <span>
              <Sparkles size={18} />
            </span>
            <div>
              <strong>AI 助手</strong>
              <small>整理思路，继续对话</small>
            </div>
            <ChevronRight size={14} />
          </button>
          <button className="dashboard-shortcut" onClick={() => navigate('mail')}>
            <span>
              <Mail size={18} />
            </span>
            <div>
              <strong>打开邮箱</strong>
              <small>
                {workspace.mailAccounts.length
                  ? `已连接 ${workspace.mailAccounts.length} 个邮箱账号`
                  : '连接学校、QQ 或 163 邮箱'}
              </small>
            </div>
            <ChevronRight size={14} />
          </button>
          <button className="dashboard-shortcut" onClick={() => navigate('campus')}>
            <span>
              <GraduationCap size={18} />
            </span>
            <div>
              <strong>校园入口</strong>
              <small>统一认证、教务与常用办事入口</small>
            </div>
            <ChevronRight size={14} />
          </button>
        </section>
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
