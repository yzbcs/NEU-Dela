import { expect, it } from 'vitest';
import { parseWebTimetable, type CoursePage } from '../src/main/web-timetable';
import { courseBlocks, courseWeeks } from '../src/main/course-text';
import { graduatePageFixture } from '../scripts/graduate-fixture';

it('周日排在第一列时仍按星期映射，跨节合并单元格可包含不同周次的安排', () => {
  const parsed = parseWebTimetable([graduatePageFixture()]);
  expect(parsed.courses).toHaveLength(3);
  expect(parsed.courses[0]).toMatchObject({
    name: '课程甲',
    day: 1,
    start: 1,
    end: 2,
    weeks: '1-4周',
    teacher: '李老师',
    location: '1号A101',
  });
  expect(parsed.courses[1]).toMatchObject({
    name: '课程乙',
    day: 2,
    start: 3,
    end: 4,
    weeks: '2周,4-10周',
  });
  expect(parsed.courses[2]).toMatchObject({
    name: '课程丙',
    day: 2,
    start: 3,
    end: 4,
    weeks: '12周',
  });
  expect(parsed.term).toBe('2026-2027学年第一学期');
  expect(parsed.sourceUrl).toBe('https://yjs.neu.edu.cn/fixture-courses');
});
it('列表式课程可读星期、起止节、单双周和教师，重复展示的表格不重复导入', () => {
  const page: CoursePage = {
    url: 'https://yjs.neu.edu.cn/fixture-list',
    title: '我的课程',
    term: '',
    tables: [
      {
        rows: [
          ['课程名称', '星期', '开始节次', '结束节次', '上课周次', '上课地点', '任课教师'],
          ['课程丁', '周五', '5', '8', '1-16单周', '1号A303', '周老师'],
        ].map((row) => row.map((text) => ({ text, rowSpan: 1, colSpan: 1 }))),
      },
    ],
  };
  const parsed = parseWebTimetable([page, page]);
  expect(parsed.courses).toHaveLength(1);
  expect(parsed.courses[0]).toMatchObject({
    name: '课程丁',
    day: 5,
    start: 5,
    end: 8,
    weeks: '1-16单周',
    location: '1号A303',
    teacher: '周老师',
  });
});
it('门户和选课列表没有上课时间时，不臆造课程安排或覆盖已有课表', () => {
  expect(() =>
    parseWebTimetable([
      {
        ...graduatePageFixture(),
        tables: [{ rows: [[{ text: '欢迎进入研究生系统', rowSpan: 1, colSpan: 1 }]] }],
      },
    ]),
  ).toThrow('进入个人课表');
});
it('没有周次的课程保留草稿并要求补全，不默认为全学期', () => {
  const page = graduatePageFixture();
  page.tables[0].rows[1][3].text = '课程甲(示例班)\n李老师\n1号A101';
  const parsed = parseWebTimetable([page]);
  expect(parsed.courses[0].weeks).toBe('');
  expect(parsed.warnings[0]).toContain('补充');
});
it('真实 PDF 中位置错序的研字不影响周次范围，换行地点合并且不吞教师', () => {
  expect(courseWeeks('3研-7周,9-10周')).toBe('3-7周,9-10周');
  expect(courseWeeks('3-7周,9-10周研')).toBe('3-7周,9-10周');
  expect(
    courseBlocks(['研2-17周', '示例课程(示例班)', '孙老师', '1号B216-智', '慧教室'])[0],
  ).toMatchObject({
    name: '示例课程',
    weeks: '2-17周',
    teacher: '孙老师',
    location: '1号B216-智慧教室',
  });
});
it('课程名自带括号且后面重复课程名作为班号时，保留课程名里的限定词', () => {
  expect(
    courseBlocks(['研1-4周', '课程甲(进阶)(课程甲(进阶)01)', '孙老师', '1号A101'])[0].name,
  ).toBe('课程甲(进阶)');
});
it('学校页面独立的研标签不会进入课程名，也不会附到上一条课程地点后', () => {
  const blocks = courseBlocks([
    '研',
    '10周',
    '课程甲(进阶)(课程甲(进阶)01)',
    '孙老师',
    '1号A101',
    '研',
    '3-9周',
    '课程甲(进阶)(课程甲(进阶)01)',
    '周老师',
    '1号A102',
  ]);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]).toMatchObject({ name: '课程甲(进阶)', weeks: '10周', location: '1号A101' });
  expect(blocks[1]).toMatchObject({ name: '课程甲(进阶)', weeks: '3-9周', location: '1号A102' });
});
