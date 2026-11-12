import { readFile } from 'node:fs/promises';
import { basename, posix } from 'node:path';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { readTimetable } from './timetable';
import { parseWebTimetable, type CoursePage, type WebCell, type WebTable } from './web-timetable';
import type { Degree } from '../shared/student-profile';
import type { TimetableImport } from '../shared/workspace';

const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const elements = (node: Element | ReturnType<typeof xml>, ns: string, name: string) => [
  ...node.getElementsByTagNameNS(ns, name),
];
const children = (node: Element, name: string) =>
  [...node.childNodes].filter(
    (child): child is Element => child.nodeType === 1 && child.localName === name,
  );
const cell = (text = '', rowSpan = 1, colSpan = 1): WebCell => ({ text, rowSpan, colSpan });

function coordinate(reference: string) {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(reference);
  if (!match) throw new Error('课表文件中的单元格位置无效');
  const col = [...match[1]].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  if (col > 1000 || row > 10000) throw new Error('请选择学校导出的课程表文件');
  return { col, row };
}

function excelTables(files: Record<string, Uint8Array>): WebTable[] {
  const strings = files['xl/sharedStrings.xml']
    ? elements(xml(strFromU8(files['xl/sharedStrings.xml'])), spreadsheetNs, 'si').map((item) =>
        elements(item, spreadsheetNs, 't')
          .map((text) => text.textContent)
          .join(''),
      )
    : [];
  const workbook = xml(strFromU8(files['xl/workbook.xml']));
  const rels = xml(strFromU8(files['xl/_rels/workbook.xml.rels']));
  return elements(workbook, spreadsheetNs, 'sheet')
    .filter((sheet) => sheet.getAttribute('state') !== 'hidden')
    .map((sheet) => {
      const id = sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      );
      const rel = [...rels.getElementsByTagName('Relationship')].find(
        (item) => item.getAttribute('Id') === id,
      );
      const target = rel?.getAttribute('Target') ?? '';
      const path = posix.resolve('/xl', target).slice(1);
      if (!files[path]) throw new Error('课表文件缺少工作表');
      const document = xml(strFromU8(files[path]));
      const grid: WebCell[][] = [];
      for (const item of elements(document, spreadsheetNs, 'c')) {
        const { row, col } = coordinate(item.getAttribute('r') ?? '');
        const type = item.getAttribute('t');
        const value = elements(item, spreadsheetNs, 'v')[0]?.textContent ?? '';
        const text =
          type === 's'
            ? (strings[Number(value)] ?? '')
            : type === 'inlineStr'
              ? elements(item, spreadsheetNs, 't')
                  .map((part) => part.textContent)
                  .join('')
              : value;
        grid[row] ??= [];
        grid[row][col] = cell(text);
      }
      const covered = new Set<string>();
      for (const merge of elements(document, spreadsheetNs, 'mergeCell')) {
        const [start, finish] = (merge.getAttribute('ref') ?? '').split(':').map(coordinate);
        if (!finish) continue;
        grid[start.row] ??= [];
        grid[finish.row] ??= [];
        const owner = (grid[start.row][start.col] ??= cell());
        owner.rowSpan = finish.row - start.row + 1;
        owner.colSpan = finish.col - start.col + 1;
        for (let y = start.row; y <= finish.row; y++)
          for (let x = start.col; x <= finish.col; x++)
            if (y !== start.row || x !== start.col) covered.add(y + ':' + x);
      }
      const width = Math.max(0, ...Array.from(grid, (row) => row?.length ?? 0));
      return {
        rows: Array.from({ length: grid.length }, (_, y) =>
          Array.from({ length: width }, (_, x) => ({ x, value: grid[y]?.[x] ?? cell() }))
            .filter(({ x }) => !covered.has(y + ':' + x))
            .map(({ value }) => value),
        ),
      };
    });
}

function wordText(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  const name = node.localName;
  if (name === 'br' || name === 'cr') return '\n';
  if (name === 'tab') return ' ';
  return [...node.childNodes].map(wordText).join('') + (name === 'p' ? '\n' : '');
}

function wordTables(document: ReturnType<typeof xml>): WebTable[] {
  const count = (value: string | null, fallback: number) => {
    const parsed = value === null ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000)
      throw new Error('请选择学校导出的课程表文件');
    return parsed;
  };
  return elements(document, wordNs, 'tbl').map((table) => {
    const active = new Map<number, WebCell>();
    return {
      rows: children(table, 'tr').map((row) => {
        let col = count(
          elements(row, wordNs, 'gridBefore')[0]?.getAttributeNS(wordNs, 'val') ?? null,
          0,
        );
        const cells: WebCell[] = Array.from({ length: col }, () => cell());
        for (const item of children(row, 'tc')) {
          const span = count(
            elements(item, wordNs, 'gridSpan')[0]?.getAttributeNS(wordNs, 'val') ?? null,
            1,
          );
          const merge = elements(item, wordNs, 'vMerge')[0];
          if (merge && merge.getAttributeNS(wordNs, 'val') !== 'restart') {
            const owner = active.get(col);
            if (!owner) throw new Error('Word 课表的合并单元格不完整');
            owner.rowSpan++;
          } else {
            const value = cell(wordText(item).trim(), 1, span);
            cells.push(value);
            for (let x = col; x < col + span; x++) {
              active.delete(x);
              if (merge) active.set(x, value);
            }
          }
          col += span;
          if (col > 1000) throw new Error('请选择学校导出的课程表文件');
        }
        return cells;
      }),
    };
  });
}

/** 按文件内容识别格式，兼容教务系统把 OOXML 下载命名为 .xls、.doc 或 .do。 */
export async function readTimetableFile(path: string, degree: Degree): Promise<TimetableImport> {
  const data = await readFile(path);
  if (data.subarray(0, 5).toString() === '%PDF-') return readTimetable(path);
  if (data[0] !== 0x50 || data[1] !== 0x4b)
    throw new Error('请选择教务系统导出的 Excel、Word 或带文字层的 PDF 课表');
  let expanded = 0;
  const files = unzipSync(data, {
    filter: (entry) => {
      expanded += entry.originalSize;
      if (expanded > 50 * 1024 * 1024) throw new Error('课表文件解压后过大，请重新导出课表');
      return /^(?:xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)|word\/document\.xml)$/.test(
        entry.name,
      );
    },
  });
  let tables: WebTable[];
  let text: string;
  if (files['xl/workbook.xml']) {
    tables = excelTables(files);
    text = tables
      .flatMap((table) => table.rows.map((row) => row.map((item) => item.text).join('\t')))
      .join('\n');
  } else if (files['word/document.xml']) {
    const document = xml(strFromU8(files['word/document.xml']));
    tables = wordTables(document);
    text = wordText(document);
  } else throw new Error('文件中没有找到 Excel 或 Word 课表');
  const page: CoursePage = {
    url: '',
    title: basename(path),
    tables,
    term:
      text.match(/20\d{2}\s*[-—–]\s*20\d{2}\s*(?:学年)?\s*(?:第?[一二12]学期|[春秋]季学期)/)?.[0] ??
      '',
  };
  let draft: TimetableImport;
  try {
    draft = parseWebTimetable([page], degree);
  } catch {
    return {
      sourceName: basename(path),
      sourcePath: path,
      term: page.term,
      courses: [],
      text: JSON.stringify({ ...page, text }, null, 2),
      warnings: [],
      recognitionError: '未能在导出文件中识别到课表，请查看原始内容并手动补充课程。',
    };
  }
  return {
    ...draft,
    sourceName: basename(path),
    sourcePath: path,
    sourceUrl: undefined,
    text,
    warnings: draft.warnings
      .filter((warning) => !warning.includes('当前页面'))
      .concat('已读取导出文件，请核对课程、周次与节次后保存。'),
  };
}
