import { parseWeeks, type Course } from '../shared/workspace';

export function courseWeeks(raw: string): string {
  const text = raw
    .normalize('NFKC')
    .replace(/^(?:上课)?周次\s*[:：]\s*/, '')
    .replace(/[研第]/g, '')
    .trim();
  try {
    parseWeeks(text);
    return text;
  } catch {
    return '';
  }
}

/** 同一单元格可按周次分出多条安排，保留原文供导入时核对。 */
export function courseBlocks(lines: string[]): Omit<Course, 'id' | 'day' | 'start' | 'end'>[] {
  const blocks: { weeks: string; lines: string[] }[] = [];
  let current = { weeks: '', lines: [] as string[] };
  for (const raw of lines) {
    const text = raw.normalize('NFKC').trim();
    if (!text || text === '研') continue;
    if (/^(?:(?:上课)?周次\s*[:：]\s*)?(?:研|第)?\s*\d[\d\s,，、\-~～—单双第研]*周/.test(text)) {
      if (current.weeks) {
        blocks.push(current);
        current = { weeks: '', lines: [] };
      }
      current.weeks = text;
    } else current.lines.push(text);
  }
  blocks.push(current);
  return blocks.flatMap((block) => {
    if (!block.lines.length) return [];
    const labelledName = block.lines.find((line) =>
      /^(?:课程名称|课程名|课程|科目)\s*[:：]/.test(line),
    );
    const locationIndex = block.lines.findIndex((line) =>
      /^(?:上课地点|地点|教室)\s*[:：]|\d+号[A-Z]|建筑[A-Z]\d|教学楼.*\d|^线上$/.test(line),
    );
    const location = locationIndex >= 0 ? block.lines.slice(locationIndex).join('') : '';
    const teacherLine = block.lines.find((line) =>
      /^(?:任课教师|授课教师|教师|老师)\s*[:：]/.test(line),
    );
    const body = (locationIndex >= 0 ? block.lines.slice(0, locationIndex) : block.lines).filter(
      (line) => line !== teacherLine,
    );
    const joined = body.join('');
    const firstParen = joined.indexOf('(');
    const classStart =
      firstParen >= 0 ? joined.indexOf('(' + joined.slice(0, firstParen), firstParen) : -1;
    const name = labelledName
      ? labelledName.replace(/^[^:：]+[:：]\s*/, '')
      : firstParen >= 0
        ? joined.slice(0, classStart >= 0 ? classStart : firstParen).trim()
        : (body[0] ?? '');
    if (!name) return [];
    const afterClass = joined.lastIndexOf(')');
    const teacher = teacherLine
      ? teacherLine.replace(/^[^:：]+[:：]\s*/, '')
      : afterClass >= 0
        ? joined.slice(afterClass + 1).trim()
        : '';
    return [
      {
        name,
        weeks: courseWeeks(block.weeks),
        location: location.replace(/^(?:上课地点|地点|教室)\s*[:：]\s*/, ''),
        teacher,
        detail: [block.weeks, ...block.lines].filter(Boolean).join('\n'),
      },
    ];
  });
}
