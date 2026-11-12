import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  ReadingAnnotation,
  ReadingAnnotationInput,
  ReadingAnnotationList,
} from '../shared/workspace';
import type { LocalFiles } from './local-files';

const colorSchema = z.enum(['yellow', 'green', 'blue', 'pink']);
const unit = z.number().finite().min(0).max(1);
const inputSchema = z
  .object({
    text: z.string().trim().min(1).max(10000),
    color: colorSchema,
    view: z.enum(['pdf', 'markdown', 'source']),
    page: z.number().int().min(1).max(100000).optional(),
    rects: z
      .array(z.object({ x: unit, y: unit, width: unit, height: unit }))
      .max(200)
      .optional(),
    start: z.number().int().min(0).max(10000000).optional(),
    end: z.number().int().min(0).max(10000000).optional(),
    comment: z.string().max(10000).optional(),
  })
  .superRefine((value, ctx) => {
    const valid =
      value.view === 'pdf'
        ? value.page && value.rects?.length
        : value.start !== undefined && value.end !== undefined && value.end > value.start;
    if (!valid) ctx.addIssue({ code: 'custom', message: '无法定位所选文字，请重新选择。' });
  });

export class ReadingAnnotations {
  constructor(
    private directory: string,
    private files: LocalFiles,
  ) {}
  private async target(id: string, path: string) {
    z.string().uuid().parse(id);
    z.string().max(4096).parse(path);
    const resolved = this.files.resolvePath(id, path).path;
    const [filePath, info] = await Promise.all([realpath(resolved), stat(resolved)]);
    if (!info.isFile()) throw new Error('请选择文件。');
    const key = createHash('sha256').update(filePath).digest('hex');
    return {
      path: join(this.directory, key + '.json'),
      version: `${info.size}:${info.mtime.toISOString()}`,
    };
  }
  private read(path: string): ReadingAnnotation[] {
    if (!existsSync(path)) return [];
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data)) throw new Error('标注数据无法读取，请检查本地数据。');
    return data as ReadingAnnotation[];
  }
  private write(path: string, items: ReadingAnnotation[]) {
    mkdirSync(this.directory, { recursive: true });
    const temporary = path + '.tmp';
    writeFileSync(temporary, JSON.stringify(items, null, 2));
    renameSync(temporary, path);
  }
  async list(id: string, path: string): Promise<ReadingAnnotationList> {
    const target = await this.target(id, path);
    return { version: target.version, items: this.read(target.path) };
  }
  async add(id: string, path: string, version: string, raw: ReadingAnnotationInput) {
    const input = inputSchema.parse(raw);
    const target = await this.target(id, path);
    if (version !== target.version) throw new Error('文件已经更改，请重新打开文件后标注。');
    const items = this.read(target.path);
    items.unshift({ ...input, id: randomUUID(), createdAt: new Date().toISOString(), version });
    this.write(target.path, items);
    return { version, items };
  }
  async update(id: string, path: string, annotationId: string, color: string, comment: string) {
    const target = await this.target(id, path);
    const items = this.read(target.path);
    const item = items.find((entry) => entry.id === z.string().uuid().parse(annotationId));
    if (!item) throw new Error('标注不存在。');
    item.color = colorSchema.parse(color);
    item.comment = z.string().max(10000).parse(comment);
    this.write(target.path, items);
    return { version: target.version, items };
  }
  async remove(id: string, path: string, annotationId: string) {
    const target = await this.target(id, path);
    const targetId = z.string().uuid().parse(annotationId);
    const items = this.read(target.path).filter((entry) => entry.id !== targetId);
    this.write(target.path, items);
    return { version: target.version, items };
  }
}
