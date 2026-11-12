import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { textExtensions } from './local-files';

const maxCharacters = 60000;
const maxPages = 100;

export async function readSummarySource(path: string, version: string, signal: AbortSignal) {
  const before = await stat(path);
  if (!before.isFile()) throw new Error('请选择文件。');
  const extension = extname(path).toLowerCase();
  if (before.size > (extension === '.pdf' ? 50 : 8) * 1024 * 1024)
    throw new Error('PDF 支持 50 MB 内，文字文件支持 8 MB 内。');
  if (`${before.size}:${before.mtime.toISOString()}` !== version)
    throw new Error('文件已经更改，请重新打开后再总结。');
  const bytes = await readFile(path, { signal });
  const after = await stat(path);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
    throw new Error('文件读取时发生更改，请重新打开后再总结。');
  if (extension !== '.pdf') {
    if (!textExtensions.has(extension)) throw new Error('暂不支持总结此格式。');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('文件不是 UTF-8 编码，无法读取文字。');
    }
    if (!text.trim()) throw new Error('文件没有可总结的文字。');
    const truncated = text.length > maxCharacters;
    return {
      source: text.slice(0, maxCharacters),
      truncated,
      scope: truncated
        ? `已读取前 ${maxCharacters} 字，共 ${text.length} 字。`
        : `已读取全文，共 ${text.length} 字。`,
    };
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
  });
  const cancel = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    const pages: string[] = [];
    const missing: number[] = [];
    let characters = 0;
    let readPages = 0;
    let partialPage = false;
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      readPages = n;
      if (!text) {
        missing.push(n);
        continue;
      }
      const remaining = maxCharacters - characters;
      const segment = text.slice(0, remaining);
      pages.push(`第 ${n} 页：\n${segment}`);
      characters += segment.length;
      if (segment.length < text.length) {
        partialPage = true;
        break;
      }
      if (characters >= maxCharacters) break;
    }
    if (!pages.length) throw new Error('PDF 没有可提取的文字；扫描件需要先进行文字识别。');
    const truncated = partialPage || readPages < pdf.numPages;
    const scope = `已读取第 1–${readPages} 页，共 ${pdf.numPages} 页${partialPage ? `（第 ${readPages} 页仅读取部分文字）` : ''}。${missing.length ? `第 ${missing.join('、')} 页没有可提取的文字。` : ''}`;
    return { source: pages.join('\n\n'), truncated, scope };
  } finally {
    signal.removeEventListener('abort', cancel);
    await task.destroy();
  }
}
