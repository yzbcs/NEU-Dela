import {
  addDays,
  chinaDate,
  dateNumber,
  parseWeeks,
  periodTimes,
  weekAt,
  type Course,
  type Timetable,
  type Todo,
  type Workspace,
} from './workspace';

export function coursesOnDate(table: Timetable, date: string): Course[] {
  if (!table.firstMonday) return [];
  const week = weekAt(table.firstMonday, date);
  const day = ((new Date(dateNumber(date)).getUTCDay() + 6) % 7) + 1;
  return table.courses
    .filter((course) => {
      try {
        return course.day === day && parseWeeks(course.weeks).includes(week);
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name, 'zh-CN'));
}

/** Pass the courses active on one date or in one week, rather than every term occurrence. */
export function courseConflicts(courses: Course[], periods = periodTimes) {
  const conflicts: { first: Course; second: Course }[] = [];
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const first = courses[i],
        second = courses[j];
      if (
        first.day === second.day &&
        periods[first.start - 1][0] < periods[second.end - 1][1] &&
        periods[second.start - 1][0] < periods[first.end - 1][1]
      )
        conflicts.push({ first, second });
    }
  }
  return conflicts;
}

export type AgendaItem =
  | { kind: 'course'; time: string; endTime: string; course: Course }
  | { kind: 'todo'; time: string; todo: Todo; overdue: boolean };

export function agendaTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function buildAgenda(workspace: Workspace, now = new Date()) {
  const today = chinaDate(now);
  const pending = workspace.todos.filter((todo) => !todo.done);
  const periods = workspace.timetable.periods ?? periodTimes;
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(today, offset);
    const courses = coursesOnDate(workspace.timetable, date);
    const todos = pending.filter((todo) => todo.dueAt && chinaDate(new Date(todo.dueAt)) === date);
    const items: AgendaItem[] = [
      ...courses.map((course): AgendaItem => ({
        kind: 'course',
        time: periods[course.start - 1][0],
        endTime: periods[course.end - 1][1],
        course,
      })),
      ...todos.map((todo): AgendaItem => ({
        kind: 'todo',
        time: agendaTime(new Date(todo.dueAt)),
        todo,
        overdue: new Date(todo.dueAt) < now,
      })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    return {
      date,
      week: weekAt(workspace.timetable.firstMonday, date),
      courses,
      todos,
      items,
      conflicts: courseConflicts(courses, periods),
    };
  });
  return {
    days,
    // Earlier dates stay outside the seven-day timeline; today's overdue items remain on today.
    earlier: pending
      .filter((todo) => todo.dueAt && chinaDate(new Date(todo.dueAt)) < today)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    undated: pending.filter((todo) => !todo.dueAt),
  };
}
