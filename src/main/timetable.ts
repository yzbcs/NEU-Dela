import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { courseBlocks } from './course-text';
import {
  addDays,
  parseWeeks,
  periodTimes,
  type Course,
  type Timetable,
  type TimetableImport,
} from '../shared/workspace';

export interface PdfWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PdfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const normalize = (text: string) => text.normalize('NFKC').replace(/[\u200b\ufeff]/g, '');
function linesOf(words: PdfWord[]): { text: string; y: number }[] {
  const rows: { y: number; words: PdfWord[] }[] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find((item) => Math.abs(item.y - word.y) < 3);
    if (!row) {
      row = { y: word.y, words: [] };
      rows.push(row);
    }
    row.words.push(word);
  }
  return rows.map((row) => ({
    y: row.y,
    text: normalize(
      row.words
        .sort((a, b) => a.x - b.x)
        .map((word) => word.text)
        .join(''),
    ).trim(),
  }));
}
/** 按实际网格边界分单元格，避免跨星期与跨行合并单元格混读。 */
export function parseTable(words: PdfWord[], lines: PdfLine[]): Course[] {
  const merged: PdfWord[] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = merged.at(-1);
    if (
      previous &&
      Math.abs(previous.y - word.y) < 1 &&
      Math.abs(word.x - previous.x - previous.width) < 1.5
    ) {
      previous.text += word.text;
      previous.width = word.x + word.width - previous.x;
    } else merged.push({ ...word });
  }
  const headers = merged.filter((word) =>
    /^(?:星期|周)[一二三四五六日天]$/.test(normalize(word.text).trim()),
  );
  if (headers.length < 5) return [];
  const vertical = lines.filter(
    (line) => Math.abs(line.x1 - line.x2) < 1 && Math.abs(line.y1 - line.y2) > 10,
  );
  const horizontal = lines.filter(
    (line) => Math.abs(line.y1 - line.y2) < 1 && Math.abs(line.x1 - line.x2) > 15,
  );
  const allRows = linesOf(words);
  const times = allRows.filter((row) => /\d{2}:\d{2}[~～\-]\d{2}:\d{2}/.test(row.text));
  if (vertical.length < 8 || !times.length) return [];
  const cells = new Map<string, { day: number; top: number; bottom: number; words: PdfWord[] }>();
  const chars = '一二三四五六日天';
  for (const header of headers) {
    const center = header.x + header.width / 2;
    const xs = [...new Set(vertical.map((line) => Math.round(line.x1 * 2) / 2))].sort(
      (a, b) => a - b,
    );
    const left = xs.filter((x) => x < center).at(-1),
      right = xs.find((x) => x > center);
    if (left === undefined || right === undefined) continue;
    const day = Math.min(7, chars.indexOf(normalize(header.text).trim().at(-1)!) + 1);
    for (const word of words.filter(
      (word) =>
        word.x + word.width / 2 > left &&
        word.x + word.width / 2 < right &&
        word.y > header.y + header.height,
    )) {
      const x = word.x + word.width / 2;
      const borders = horizontal
        .filter(
          (line) => Math.min(line.x1, line.x2) <= x + 1 && Math.max(line.x1, line.x2) >= x - 1,
        )
        .map((line) => line.y1)
        .sort((a, b) => a - b);
      const top = borders.filter((y) => y < word.y).at(-1),
        bottom = borders.find((y) => y > word.y + 1);
      if (top === undefined || bottom === undefined) continue;
      const key = [day, Math.round(top), Math.round(bottom)].join(':');
      if (!cells.has(key)) cells.set(key, { day, top, bottom, words: [] });
      cells.get(key)!.words.push(word);
    }
  }
  const courses: Course[] = [];
  for (const cell of cells.values()) {
    const rows = linesOf(cell.words).filter((row) => row.text);
    const periods = times
      .map((row, i) => ({ y: row.y, index: i + 1 }))
      .filter((row) => row.y > cell.top && row.y < cell.bottom);
    if (!periods.length) continue;
    for (const block of courseBlocks(rows.map((row) => row.text))) {
      courses.push({
        ...block,
        id: randomUUID(),
        day: cell.day,
        start: periods[0].index,
        end: periods.at(-1)!.index,
      });
    }
  }
  return courses;
}
export async function readTimetable(path: string): Promise<TimetableImport> {
  const { getDocument, OPS, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(path));
  const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data,
    useSystemFonts: true,
    cMapUrl: join(pdfRoot, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/',
  });
  const courses: Course[] = [];
  const texts: string[] = [];
  try {
    const doc = await task.promise;
    if (doc.numPages > 20) throw new Error('请导入课表 PDF，最多支持 20 页');
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const words: PdfWord[] = content.items.flatMap((item) =>
        'str' in item && item.str.trim()
          ? [
              {
                text: normalize(item.str),
                x: item.transform[4],
                y: height - item.transform[5],
                width: item.width,
                height: item.height,
              },
            ]
          : [],
      );
      texts.push(
        linesOf(words)
          .map((row) => row.text)
          .join('\n'),
      );
      const ops = await page.getOperatorList();
      const lines: PdfLine[] = [];
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i],
          args = ops.argsArray[i];
        if (fn === OPS.save) stack.push([...matrix]);
        else if (fn === OPS.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) matrix = Util.transform(matrix, args);
        else if (fn === OPS.constructPath && args[1]?.[0]) {
          const data = args[1][0] as Float32Array;
          let previous: number[] | null = null,
            start: number[] | null = null;
          const point = (x: number, y: number) => {
            const p: [number, number] = [x, y];
            Util.applyTransform(p, matrix);
            return [p[0], height - p[1]];
          };
          const segment = (p: number[], q: number[]) =>
            lines.push({ x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
          for (let j = 0; j < data.length;) {
            const op = data[j++];
            if (op === 0) {
              previous = point(data[j++], data[j++]);
              start = previous;
            } else if (op === 1) {
              const p = point(data[j++], data[j++]);
              if (previous) segment(previous, p);
              previous = p;
            } else if (op === 4) {
              if (previous && start) segment(previous, start);
              previous = start;
            } else if (op === 2) {
              j += 6;
              previous = null;
            } else if (op === 3) {
              j += 4;
              previous = null;
            } else break;
          }
        }
      }
      courses.push(...parseTable(words, lines));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const text = texts.join('\n\n');
  return {
    sourcePath: path,
    sourceName: basename(path),
    courses,
    text,
    warnings: [
      !text.trim()
        ? '这份 PDF 没有可提取文字，请查看原文件并手动添加课程。'
        : courses.length
          ? '已生成课程草稿，请核对每条课程的星期、节次、周次和地点。'
          : '暂未识别出课程表格，请参考原文件或提取文字手动添加课程。',
      '请填写学期名称及第一周的周一日期。',
    ],
  };
}
const escapeIcs = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, '\\$&');
const stamp = (date: string, time: string) =>
  new Date(date + 'T' + time + ':00+08:00')
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
export function timetableIcs(table: Timetable): string {
  const times = table.periods ?? periodTimes;
  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NEU Dot//Timetable//ZH',
    'CALSCALE:GREGORIAN',
  ];
  for (const course of table.courses)
    for (const week of parseWeeks(course.weeks)) {
      const date = addDays(table.firstMonday, (week - 1) * 7 + course.day - 1);
      rows.push(
        'BEGIN:VEVENT',
        `UID:${course.id}-${week}@neu-dola.local`,
        `DTSTAMP:${new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}/, '')}`,
        `DTSTART:${stamp(date, times[course.start - 1][0])}`,
        `DTEND:${stamp(date, times[course.end - 1][1])}`,
        `SUMMARY:${escapeIcs(course.name)}`,
        `LOCATION:${escapeIcs(course.location)}`,
        `DESCRIPTION:${escapeIcs(course.teacher + '\n' + course.detail)}`,
        'END:VEVENT',
      );
    }
  rows.push('END:VCALENDAR');
  // RFC 5545 的 75 字节折行，不拆 UTF-8 字符。
  return (
    rows
      .map((row) => {
        let result = '',
          line = '';
        for (const char of row) {
          if (Buffer.byteLength(line + char) > 73) {
            result += line + '\r\n ';
            line = '';
          }
          line += char;
        }
        return result + line;
      })
      .join('\r\n') + '\r\n'
  );
}
