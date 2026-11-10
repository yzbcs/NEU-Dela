import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import type { ImageContent } from '@earendil-works/pi-ai';
import { textExtensions } from './local-files';

export const imageMimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
export function textChunk(text: string, offset: number, length: number) {
  return {
    text: text.slice(offset, offset + length),
    totalCharacters: text.length,
    offset,
    nextOffset: offset + length < text.length ? offset + length : null,
  };
}
export async function readFileContent(
  path: string,
  options: { page: number; offset: number; length: number; mode: 'text' | 'image' },
  signal: AbortSignal,
): Promise<{ data: object; images?: ImageContent[] }> {
  const info = await stat(path);
  const extension = extname(path).toLowerCase();
  if (!info.isFile()) throw new Error('请选择文件。');
  if (info.size > (extension === '.pdf' ? 50 : 8) * 1024 * 1024)
    throw new Error('PDF 支持 50 MB 内，文字和图片支持 8 MB 内，请拆分后添加。');
  signal.throwIfAborted();
  const bytes = await readFile(path, { signal });
  if (imageMimeTypes[extension])
    return {
      data: { format: 'image' },
      images: [
        { type: 'image', data: bytes.toString('base64'), mimeType: imageMimeTypes[extension] },
      ],
    };
  if (extension !== '.pdf') {
    if (!textExtensions.has(extension))
      throw new Error('暂不支持读取此格式。支持 PDF、PNG、JPEG、WebP 和 UTF-8 文字文件。');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('文件不是 UTF-8 编码，请转换编码后重新添加。');
    }
    return { data: textChunk(text, options.offset, options.length) };
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    cMapUrl: join(pdfRoot, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/',
  });
  const cancel = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const doc = await task.promise;
    if (options.page > doc.numPages) throw new Error('PDF 只有 ' + doc.numPages + ' 页。');
    const page = await doc.getPage(options.page);
    const metadata = {
      page: options.page,
      totalPages: doc.numPages,
      nextPage: options.page < doc.numPages ? options.page + 1 : null,
    };
    if (options.mode === 'image') {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 2000 / Math.max(base.width, base.height)),
      });
      const factory = doc.canvasFactory as {
        create(
          width: number,
          height: number,
        ): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
        destroy(target: object): void;
      };
      const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvas: target.canvas, canvasContext: target.context, viewport })
          .promise;
        signal.throwIfAborted();
        return {
          data: { ...metadata, format: 'image' },
          images: [
            {
              type: 'image',
              mimeType: 'image/png',
              data: target.canvas.toDataURL('image/png').split(',')[1],
            },
          ],
        };
      } finally {
        factory.destroy(target);
      }
    }
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
      .join('');
    if (!text.trim())
      throw new Error(
        '这一页没有可提取的文字，可能是扫描图片。请使用支持图片理解的模型，以 mode=image 读取该页。',
      );
    return { data: { ...metadata, ...textChunk(text, options.offset, options.length) } };
  } finally {
    signal.removeEventListener('abort', cancel);
    await task.destroy();
  }
}
