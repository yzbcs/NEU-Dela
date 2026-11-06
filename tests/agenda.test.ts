import { expect, it } from 'vitest';
import { buildAgenda, courseConflicts, coursesOnDate } from '../src/shared/agenda';
import { emptyWorkspace, periodTimes, type Course, type Todo } from '../src/shared/workspace';

function course(input: Partial<Course> = {}): Course {
  return {
    id: 'course-1',
    name: '线性代数',
    day: 1,
    start: 1,
    end: 2,
    weeks: '1-16',
    location: 'A101',
    teacher: '',
    detail: '',
    ...input,
  };
}
function todo(input: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    title: '提交作业',
    detail: '',
    color: 'yellow',
    dueAt: '',
    reminder: false,
    repeat: 'none',
    done: false,
    notifiedAt: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...input,
  };
}

it('七天日程跨周按真实日期选择单双周课程，不把未设置的学期当成当前周', () => {
  const workspace = emptyWorkspace();
  workspace.timetable.firstMonday = '2026-11-02';
  workspace.timetable.courses = [
    course({ id: 'odd', weeks: '1-16单周' }),
    course({ id: 'even', weeks: '1-16双周' }),
    course({ id: 'sunday', day: 7 }),
  ];
  const agenda = buildAgenda(workspace, new Date('2026-11-08T00:00:00Z'));
  expect(agenda.days.map((day) => day.date)).toEqual([
    '2026-11-08',
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-14',
  ]);
  expect(agenda.days[0].courses.map((item) => item.id)).toEqual(['sunday']);
  expect(agenda.days[1].courses.map((item) => item.id)).toEqual(['even']);
  expect(agenda.days[1].week).toBe(2);
  expect(coursesOnDate({ ...workspace.timetable, firstMonday: '' }, '2026-11-09')).toEqual([]);
  expect(coursesOnDate(workspace.timetable, '2026-10-26')).toEqual([]);
});

it('北京时间午夜分组，过去与无时间事项不挤入今天，已完成事项不再显示', () => {
  const workspace = emptyWorkspace();
  workspace.todos = [
    todo({ id: 'last-night', dueAt: '2026-11-06T15:30:00Z' }),
    todo({ id: 'today', dueAt: '2026-11-06T16:30:00Z' }),
    todo({ id: 'next-day', dueAt: '2026-11-07T16:30:00Z' }),
    todo({ id: 'undated' }),
    todo({ id: 'done', dueAt: '2026-11-06T16:30:00Z', done: true }),
  ];
  const agenda = buildAgenda(workspace, new Date('2026-11-06T17:00:00Z'));
  expect(agenda.days[0].date).toBe('2026-11-07');
  expect(agenda.days[0].todos.map((item) => item.id)).toEqual(['today']);
  expect(agenda.days[0].items[0]).toMatchObject({ kind: 'todo', time: '00:30', overdue: true });
  expect(agenda.days[1].todos.map((item) => item.id)).toEqual(['next-day']);
  expect(agenda.earlier.map((item) => item.id)).toEqual(['last-night']);
  expect(agenda.undated.map((item) => item.id)).toEqual(['undated']);
});

it('课程与待办按自定义节次时间混排，重复事项只显示已经保存的本次时间', () => {
  const workspace = emptyWorkspace();
  workspace.timetable.firstMonday = '2026-11-02';
  workspace.timetable.periods = periodTimes.map(([start, end]) => [start, end]);
  workspace.timetable.periods[0] = ['07:50', '08:20'];
  workspace.timetable.courses = [course({ end: 1 })];
  workspace.todos = [
    todo({ id: 'early', dueAt: '2026-11-01T23:30:00Z' }),
    todo({ id: 'repeat', dueAt: '2026-11-02T01:00:00Z', repeat: 'daily' }),
  ];
  const agenda = buildAgenda(workspace, new Date('2026-11-01T16:00:00Z'));
  expect(agenda.days[0].items.map((item) => item.time)).toEqual(['07:30', '07:50', '09:00']);
  expect(agenda.days[0].items[1]).toMatchObject({ kind: 'course', endTime: '08:20' });
  expect(agenda.days.flatMap((day) => day.todos).map((item) => item.id)).toEqual([
    'early',
    'repeat',
  ]);
});

it('重叠提示只比较同日有效课程，前课结束等于后课开始不算冲突', () => {
  const times = periodTimes.map(([start, end]) => [start, end]);
  times[0] = ['08:00', '09:00'];
  times[1] = ['09:00', '10:00'];
  const first = course({ id: 'first', end: 1 });
  const next = course({ id: 'next', start: 2, end: 2 });
  const overlapping = course({ id: 'overlap', start: 1, end: 2 });
  const otherDay = course({ id: 'other-day', day: 2, end: 1 });
  expect(courseConflicts([first, next, otherDay], times)).toEqual([]);
  expect(
    courseConflicts([first, next, overlapping, otherDay], times).map(({ first, second }) => [
      first.id,
      second.id,
    ]),
  ).toEqual([
    ['first', 'overlap'],
    ['next', 'overlap'],
  ]);
  const workspace = emptyWorkspace();
  workspace.timetable.firstMonday = '2026-11-02';
  workspace.timetable.courses = [first, course({ id: 'only-next-week', weeks: '2' })];
  expect(buildAgenda(workspace, new Date('2026-11-02T00:00:00Z')).days[0].conflicts).toEqual([]);
});
