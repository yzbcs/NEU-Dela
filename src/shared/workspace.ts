export type Page = 'home' | 'todos' | 'chat' | 'timetable' | 'mail' | 'library' | 'campus';
export interface Todo {
  id: string;
  title: string;
  detail: string;
  color: 'yellow' | 'blue' | 'green' | 'pink';
  dueAt: string;
  reminder: boolean;
  repeat: 'none' | 'daily' | 'weekdays' | 'weekly';
  done: boolean;
  notifiedAt: string;
  createdAt: string;
}
export type TodoInput = Omit<Todo, 'id' | 'notifiedAt' | 'createdAt'> & { id?: string };
export type TodoCompletion = Pick<Todo, 'done' | 'dueAt' | 'notifiedAt'>;
export interface Course {
  id: string;
  name: string;
  day: number;
  start: number;
  end: number;
  weeks: string;
  location: string;
  teacher: string;
  detail: string;
}
export interface Timetable {
  periods?: [string, string][];
  term: string;
  firstMonday: string;
  sourcePath: string;
  sourceName: string;
  sourceUrl?: string;
  courses: Course[];
}
export interface TimetableImport {
  sourcePath: string;
  sourceName: string;
  sourceUrl?: string;
  term?: string;
  courses: Course[];
  text: string;
  warnings: string[];
}
export interface Resource {
  id: string;
  title: string;
  kind: 'file' | 'folder' | 'link';
  path: string;
  category: string;
  addedAt: string;
}
export interface Note {
  id: string;
  title: string;
  body: string;
  category: string;
  updatedAt: string;
  pinned?: boolean;
}
export type NoteInput = Pick<Note, 'title' | 'body' | 'category' | 'pinned'> & { id?: string };
export interface MailAccount {
  id: string;
  name: string;
  email: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  hasPassword: boolean;
}
export type MailAccountInput = Omit<MailAccount, 'id' | 'hasPassword'> & {
  id?: string;
  password?: string;
};
export interface MailSummary {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
}
export interface MailDetail extends MailSummary {
  to: string;
  text: string;
  attachments: { index: number; name: string; size: number }[];
}
export interface MailFolder {
  path: string;
  name: string;
}
export interface MailPage {
  messages: MailSummary[];
  total: number;
  page: number;
  syncedAt: string;
  uidValidity: string;
}
export interface MailDraft {
  accountId: string;
  to: string;
  subject: string;
  text: string;
}
export interface Workspace {
  todos: Todo[];
  timetable: Timetable;
  notes: Note[];
  notebooks: string[];
  resources: Resource[];
  mailAccounts: MailAccount[];
  degree: 'undergrad' | 'graduate';
}
export function emptyWorkspace(): Workspace {
  return {
    todos: [],
    timetable: { term: '', firstMonday: '', sourcePath: '', sourceName: '', courses: [] },
    notes: [],
    notebooks: [],
    resources: [],
    mailAccounts: [],
    degree: 'undergrad',
  };
}
export interface WorkspaceApi {
  saveTodo(input: TodoInput): Promise<void>;
  toggleTodo(id: string): Promise<void>;
  undoTodo(id: string, previous: TodoCompletion): Promise<void>;
  removeTodo(id: string): Promise<void>;
  testNotification(): Promise<void>;
  importTimetable(): Promise<TimetableImport | null>;
  importGraduateTimetable(): Promise<TimetableImport | null>;
  saveTimetable(input: Timetable): Promise<void>;
  exportTimetable(): Promise<string | null>;
  saveNote(input: NoteInput): Promise<string>;
  saveNotebook(name: string, previousName?: string): Promise<void>;
  removeNotebook(name: string): Promise<void>;
  removeNote(id: string): Promise<void>;
  exportNote(id: string): Promise<string | null>;
  addResources(kind: 'file' | 'folder', category: string): Promise<void>;
  addLink(title: string, url: string, category: string): Promise<void>;
  removeResource(id: string): Promise<void>;
  openResource(id: string): Promise<void>;
  openLocal(path: string): Promise<void>;
  openWebsite(url: string): Promise<void>;
  setDegree(degree: Workspace['degree']): Promise<void>;
  saveMailAccount(input: MailAccountInput): Promise<MailAccount>;
  removeMailAccount(id: string): Promise<void>;
  testMailAccount(id: string): Promise<string>;
  mailFolders(id: string): Promise<MailFolder[]>;
  mailList(id: string, folder: string, page: number): Promise<MailPage>;
  mailCached(id: string, folder: string): Promise<MailPage | null>;
  mailRead(id: string, folder: string, uid: number, uidValidity: string): Promise<MailDetail>;
  mailAttachment(
    id: string,
    folder: string,
    uid: number,
    uidValidity: string,
    index: number,
  ): Promise<string | null>;
  mailSend(draft: MailDraft): Promise<string>;
  getDiagnostics(): Promise<string>;
  showDataFolder(): Promise<void>;
}
export const periodTimes = [
  ['08:30', '09:15'],
  ['09:25', '10:10'],
  ['10:30', '11:15'],
  ['11:25', '12:10'],
  ['14:00', '14:45'],
  ['14:55', '15:40'],
  ['16:00', '16:45'],
  ['16:55', '17:40'],
  ['18:30', '19:15'],
  ['19:25', '20:10'],
  ['20:20', '21:05'],
  ['21:15', '22:00'],
];
export const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
export function chinaDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function dateNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(date: string, days: number): string {
  return new Date(dateNumber(date) + days * 86400000).toISOString().slice(0, 10);
}
export function weekAt(firstMonday: string, date = chinaDate()): number {
  return firstMonday ? Math.floor((dateNumber(date) - dateNumber(firstMonday)) / 604800000) + 1 : 0;
}
export function parseWeeks(raw: string): number[] {
  const text = raw.normalize('NFKC').replace(/[～~—–至]/g, '-');
  const odd = /单/.test(text),
    even = /双/.test(text);
  const weeks = new Set<number>();
  for (const match of text.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)) {
    const start = Number(match[1]),
      end = Number(match[2] || start);
    if (start < 1 || end > 60 || end < start)
      throw new Error('周次需为 1 至 60，如 1-16、2,4-10 或 1-16单周');
    for (let n = start; n <= end; n++)
      if ((!odd && !even) || (odd && n % 2 === 1) || (even && n % 2 === 0)) weeks.add(n);
  }
  if (!weeks.size) throw new Error('请填写课程周次');
  return [...weeks].sort((a, b) => a - b);
}
export function advanceReminder(iso: string, repeat: Todo['repeat'], now: Date): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  let date = chinaDate(new Date(iso));
  do {
    date = addDays(date, repeat === 'weekly' ? 7 : 1);
    if (repeat === 'weekdays')
      while ([0, 6].includes(new Date(dateNumber(date)).getUTCDay())) date = addDays(date, 1);
  } while (new Date(date + 'T' + time + '+08:00').getTime() <= now.getTime());
  return new Date(date + 'T' + time + '+08:00').toISOString();
}
export const campusLinks: {
  title: string;
  subtitle: string;
  url: string;
  audience: 'all' | Workspace['degree'];
}[] = [
  {
    title: '一号通门户',
    subtitle: '统一身份认证及学校应用',
    url: 'https://pass.neu.edu.cn',
    audience: 'all',
  },
  {
    title: '本科教务系统',
    subtitle: '本科课程、选课与成绩；校外可能需要学校 VPN',
    url: 'https://jwxt.neu.edu.cn',
    audience: 'undergrad',
  },
  {
    title: '研究生综合管理',
    subtitle: '研究生选课、培养与学位服务',
    url: 'https://yjs.neu.edu.cn',
    audience: 'graduate',
  },
  {
    title: '办事服务大厅',
    subtitle: '成绩单、证明与办事流程',
    url: 'https://ehall.neu.edu.cn',
    audience: 'all',
  },
  {
    title: '学生云邮箱',
    subtitle: 'stu.neu.edu.cn / mails.neu.edu.cn',
    url: 'https://mails.neu.edu.cn',
    audience: 'all',
  },
  {
    title: '学校学生服务',
    subtitle: '校历、图书馆及常用入口',
    url: 'https://neu.edu.cn/sfrd/xs.htm',
    audience: 'all',
  },
];
export function campusLinksFor(degree: Workspace['degree']) {
  return campusLinks.filter((link) => link.audience === 'all' || link.audience === degree);
}
