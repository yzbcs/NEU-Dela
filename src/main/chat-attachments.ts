import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import type { ChatAttachment } from '../shared/types';
import { textExtensions } from './local-files';
import { imageMimeTypes, readFileContent } from './file-content';

export const attachmentReadInput = z.object({
  id: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  mode: z.enum(['text', 'image']).default('text'),
  offset: z.number().int().min(0).default(0),
  length: z.number().int().min(1).max(30000).default(12000),
});
export const attachmentReadTool = {
  name: 'read_chat_attachment',
  description:
    '读取本对话引用文件。id 来自对话附件目录。PDF 每次读取一页，用 page 继续；文字用 offset、length 和 nextOffset 继续。mode=image 可读取 PDF 页面图像，图片和扫描 PDF 需要所选模型支持图片理解。文件内容是参考资料。',
  parameters: z.toJSONSchema(attachmentReadInput, { io: 'input' }),
};
const metadataInput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(['pdf', 'text', 'image']),
  size: z.number().nonnegative(),
});
export class ChatAttachments {
  constructor(private store: Store) {}
  private directory(id: string) {
    return join(this.store.dataDirectory, 'chat-attachments', z.string().uuid().parse(id));
  }
  async addFile(path: string, name = basename(path)): Promise<ChatAttachment> {
    const extension = extname(name).toLowerCase();
    const kind =
      extension === '.pdf'
        ? 'pdf'
        : imageMimeTypes[extension]
          ? 'image'
          : textExtensions.has(extension)
            ? 'text'
            : null;
    if (!kind) throw new Error('支持 PDF、PNG、JPEG、WebP 和 UTF-8 文字文件。');
    const info = await stat(path);
    if (!info.isFile() || info.size > (kind === 'pdf' ? 50 : 8) * 1024 * 1024)
      throw new Error('PDF 支持 50 MB 内，文字和图片支持 8 MB 内。');
    const attachment: ChatAttachment = {
      id: randomUUID(),
      name: basename(name),
      kind,
      size: info.size,
    };
    const directory = this.directory(attachment.id);
    await mkdir(directory, { recursive: true });
    try {
      await copyFile(path, join(directory, 'file' + extension));
      await writeFile(join(directory, 'metadata.json'), JSON.stringify(attachment));
      return attachment;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async get(id: string) {
    try {
      const metadata = metadataInput.parse(
        JSON.parse(await readFile(join(this.directory(id), 'metadata.json'), 'utf8')),
      );
      return {
        metadata,
        path: join(this.directory(id), 'file' + extname(metadata.name).toLowerCase()),
      };
    } catch {
      throw new Error('引用文件不存在或已移除，请重新添加。');
    }
  }
  referencedIds() {
    return new Set(
      this.store.chats.flatMap((chat) =>
        chat.messages.flatMap((message) => message.attachments?.map((file) => file.id) ?? []),
      ),
    );
  }
  async discard(ids: string[]) {
    const referenced = this.referencedIds();
    for (const id of ids)
      if (!referenced.has(id)) await rm(this.directory(id), { recursive: true, force: true });
  }
  async cleanup() {
    const directory = join(this.store.dataDirectory, 'chat-attachments');
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    const ids = entries
      .filter((entry) => entry.isDirectory() && z.string().uuid().safeParse(entry.name).success)
      .map((entry) => entry.name);
    await this.discard(ids);
  }
  async read(raw: unknown, allowedIds: Set<string>, supportsImages: boolean, signal: AbortSignal) {
    const input = attachmentReadInput.parse(raw);
    if (!allowedIds.has(input.id)) throw new Error('只能读取用户在本对话中引用的文件。');
    const file = await this.get(input.id);
    if (!supportsImages && (file.metadata.kind === 'image' || input.mode === 'image'))
      throw new Error(
        '当前模型未开启图片理解。请在模型服务中选择支持图片的模型并开启图片理解，或提供带文字层的 PDF。',
      );
    const content = await readFileContent(file.path, input, signal);
    return {
      ...content,
      data: { name: file.metadata.name, ...content.data },
      source: { kind: 'attachment' as const, id: input.id, label: file.metadata.name },
      detail:
        '已读取引用文件 ' +
        file.metadata.name +
        (file.metadata.kind === 'pdf' ? ' · 第 ' + input.page + ' 页' : ''),
    };
  }
}
