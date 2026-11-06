import { randomUUID } from 'node:crypto';
import { periodTimes, type Course, type TimetableImport } from '../shared/workspace';
import { courseBlocks, courseWeeks } from './course-text';

export interface WebCell {
  text: string;
  rowSpan: number;
  colSpan: number;
}
export interface WebTable {
  rows: WebCell[][];
}
export interface CoursePage {
  url: string;
  title: string;
  term: string;
  tables: WebTable[];
}

/** 在学校网页自身的 frame 中运行，只读取已展示的表格和学期文字。 */
export function captureCoursePage(): CoursePage | null {
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    return (
      element.getClientRects().length > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  };
  if (window.frameElement && !visible(window.frameElement)) return null;
  const tables = [...document.querySelectorAll('table')].filter(visible).map((table) => ({
    rows: [...table.rows]
      .filter((row) => row.closest('table') === table && visible(row))
      .map((row) =>
        [...row.cells].filter(visible).map((cell) => ({
          text: cell.innerText.trim(),
          rowSpan: cell.rowSpan || 1,
          colSpan: cell.colSpan || 1,
        })),
      ),
  }));
  const text =
    [...document.querySelectorAll('select')]
      .flatMap((select) => [...select.selectedOptions].map((option) => option.text))
      .join('\n') +
    '\n' +
    document.body.innerText;
  const term =
    text.match(/20\d{2}\s*[-—–]\s*20\d{2}\s*(?:学年)?\s*(?:第?[一二12]学期|[春秋]季学期)/)?.[0] ??
    '';
  return { url: location.origin + location.pathname, title: document.title, term, tables };
}

const clean = (text: string) => text.normalize('NFKC').trim();
const numerals: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};
function dayNumber(text: string) {
  const match = /(?:星期|周)([一二三四五六日天])/.exec(clean(text));
  if (match) return Math.min(7, '一二三四五六日天'.indexOf(match[1]) + 1);
  return /^[1-7]$/.test(clean(text)) ? Number(text) : 0;
}
function periodRange(raw: string): [number, number] | null {
  const text = clean(raw).replace(/[～~—–至、,]/g, '-');
  const match =
    /(?:第)?(\d{1,2}|十二|十一|[一二三四五六七八九十])(?:\s*-\s*(\d{1,2}|十二|十一|[一二三四五六七八九十]))?\s*节/.exec(
      text,
    ) ?? /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/.exec(text);
  if (match) {
    const start = Number(match[1]) || numerals[match[1]],
      end = Number(match[2]) || numerals[match[2]] || start;
    if (start >= 1 && end >= start && end <= 12) return [start, end];
  }
  const time = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/.exec(text);
  if (time) {
    const start = periodTimes.findIndex((row) => row[0] === time[1]);
    const end = periodTimes.findIndex((row) => row[1] === time[2]);
    if (start >= 0 && end >= start) return [start + 1, end + 1];
  }
  return null;
}
interface PlacedCell extends WebCell {
  row: number;
  col: number;
}
function layout(table: WebTable) {
  const grid: PlacedCell[][] = [],
    cells: PlacedCell[] = [];
  table.rows.forEach((row, y) => {
    grid[y] ??= [];
    let x = 0;
    for (const source of row) {
      while (grid[y][x]) x++;
      const cell = { ...source, text: clean(source.text), row: y, col: x };
      cells.push(cell);
      for (let dy = 0; dy < cell.rowSpan; dy++) {
        grid[y + dy] ??= [];
        for (let dx = 0; dx < cell.colSpan; dx++) grid[y + dy][x + dx] = cell;
      }
      x += cell.colSpan;
    }
  });
  return { grid, cells };
}
function parseList(grid: PlacedCell[][]): Course[] | null {
  const labels: Record<string, string[]> = {
    name: ['课程名称', '课程名', '课程'],
    day: ['星期', '上课星期', '星期几'],
    start: ['开始节', '开始节次', '起始节'],
    end: ['结束节', '结束节次', '终止节'],
    periods: ['节次', '上课节次', '上课时间'],
    weeks: ['周次', '上课周次', '教学周'],
    location: ['地点', '教室', '上课地点'],
    teacher: ['教师', '任课教师', '授课教师'],
  };
  let columns: Record<string, number> = {},
    header = -1;
  for (let y = 0; y < grid.length; y++) {
    const found: Record<string, number> = {};
    for (const [field, names] of Object.entries(labels)) {
      const col = grid[y].findIndex((cell) => cell && names.includes(cell.text.replace(/\s/g, '')));
      if (col >= 0) found[field] = col;
    }
    if (
      found.name !== undefined &&
      found.weeks !== undefined &&
      (found.periods !== undefined || found.start !== undefined)
    ) {
      columns = found;
      header = y;
      break;
    }
  }
  if (header < 0) return null;
  const result: Course[] = [];
  for (const row of grid.slice(header + 1)) {
    const get = (field: string) => row[columns[field]]?.text ?? '';
    const name = get('name'),
      periodText = get('periods');
    const day = dayNumber(get('day') || periodText);
    const range =
      columns.start !== undefined
        ? periodRange(get('start') + (get('end') ? '-' + get('end') : '') + '节')
        : periodRange(periodText);
    if (!name || !day || !range) continue;
    result.push({
      id: randomUUID(),
      name,
      day,
      start: range[0],
      end: range[1],
      weeks: courseWeeks(get('weeks')),
      teacher: get('teacher'),
      location: get('location'),
      detail: Object.keys(columns)
        .map((field) => field + ': ' + get(field))
        .join('\n'),
    });
  }
  return result;
}
function parseGrid(cells: PlacedCell[]): Course[] {
  const headers = cells.filter((cell) =>
    /^(?:星期|周)[一二三四五六日天](?:\s|\(|$)/.test(cell.text),
  );
  if (headers.length < 5) return [];
  const firstDay = Math.min(...headers.map((cell) => cell.col));
  const rowPeriods = new Map<number, [number, number]>();
  for (const cell of cells.filter((cell) => cell.col < firstDay)) {
    const range = periodRange(cell.text);
    if (range) rowPeriods.set(cell.row, range);
  }
  const courses: Course[] = [];
  for (const cell of cells) {
    const header = headers.find(
      (item) => cell.row > item.row && cell.col >= item.col && cell.col < item.col + item.colSpan,
    );
    if (!header || !cell.text) continue;
    const periods = [...rowPeriods]
      .filter(([row]) => row >= cell.row && row < cell.row + cell.rowSpan)
      .sort((a, b) => a[0] - b[0]);
    if (!periods.length) continue;
    for (const block of courseBlocks(cell.text.split('\n')))
      courses.push({
        ...block,
        id: randomUUID(),
        day: dayNumber(header.text),
        start: periods[0][1][0],
        end: periods.at(-1)![1][1],
      });
  }
  return courses;
}
export function parseWebTimetable(pages: CoursePage[]): TimetableImport {
  const courses: Course[] = [],
    texts: string[] = [];
  let sourceUrl = '',
    term = '';
  for (const page of pages)
    for (const table of page.tables) {
      const { grid, cells } = layout(table);
      const parsed = parseList(grid) ?? parseGrid(cells);
      if (!parsed.length) continue;
      sourceUrl ||= page.url;
      term ||= page.term;
      texts.push(table.rows.map((row) => row.map((cell) => cell.text).join('\t')).join('\n'));
      for (const course of parsed)
        if (
          !courses.some(
            (old) =>
              old.name === course.name &&
              old.day === course.day &&
              old.start === course.start &&
              old.end === course.end &&
              old.weeks === course.weeks &&
              old.location === course.location &&
              old.teacher === course.teacher,
          )
        )
          courses.push(course);
    }
  if (!courses.length)
    throw new Error('没有识别到课程。请先登录，进入个人课表并选择全学期显示，再点击读取。');
  const warnings = [
    '读取的是当前页面已展示的课程，请核对学期、周次与课程数量后保存；分页列表请先选择显示全部。',
    '请确认第一周的周一日期。',
  ];
  if (courses.some((course) => !course.weeks))
    warnings.unshift('部分课程没有可识别的周次，请在保存前补充。');
  return {
    courses,
    text: texts.join('\n\n'),
    sourcePath: '',
    sourceName: '研究生系统网页课表',
    sourceUrl,
    term,
    warnings,
  };
}
