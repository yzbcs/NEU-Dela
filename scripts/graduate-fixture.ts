import type { CoursePage, WebCell, WebTable } from '../src/main/web-timetable';

const cell = (text: string, rowSpan = 1, colSpan = 1): WebCell => ({ text, rowSpan, colSpan });
export function graduateTableFixture(): WebTable {
  const rows: WebCell[][] = [
    [
      cell('节次/星期'),
      cell('时间'),
      ...['日', '一', '二', '三', '四', '五', '六'].map((day) => cell('星期' + day)),
    ],
  ];
  const labels = ['一', '二', '三', '四'];
  const times = ['08:30~09:15', '09:25~10:10', '10:30~11:15', '11:25~12:10'];
  for (let index = 0; index < 4; index++) {
    const row = [cell('第' + labels[index] + '节'), cell(times[index])];
    for (let day = 0; day < 7; day++) {
      if ((index === 1 && day === 1) || (index === 3 && day === 2)) continue;
      row.push(
        index === 0 && day === 1
          ? cell('研\n1-4周\n课程甲(示例班)\n李老师\n1号A101', 2)
          : index === 2 && day === 2
            ? cell(
                '研\n2周,4-10周\n课程乙(示例班)\n赵老师\n1号B202\n研\n12周\n课程丙(示例班)\n钱老师\n建筑A102',
                2,
              )
            : cell(''),
      );
    }
    rows.push(row);
  }
  return { rows };
}
export function graduatePageFixture(): CoursePage {
  return {
    url: 'https://yjs.neu.edu.cn/fixture-courses',
    title: '个人课表',
    term: '2026-2027学年第一学期',
    tables: [graduateTableFixture()],
  };
}
export function graduateFixtureHtml() {
  const table = graduateTableFixture();
  return (
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>人工课表页面</title><style>body{font:14px sans-serif;color:#264564;padding:24px}table{border-collapse:collapse;width:100%}td{border:1px solid #ccd8e5;padding:12px;white-space:pre-line}h2{font-size:20px}</style><h2>2026-2027学年第一学期 · 人工测试课表</h2><table>' +
    table.rows
      .map(
        (row) =>
          '<tr>' +
          row
            .map(
              (entry) =>
                `<td rowspan="${entry.rowSpan}" colspan="${entry.colSpan}">${entry.text}</td>`,
            )
            .join('') +
          '</tr>',
      )
      .join('') +
    '</table></html>'
  );
}
