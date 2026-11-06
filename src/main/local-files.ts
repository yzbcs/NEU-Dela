import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Store } from './store';
import type {
  LocalDirectory,
  LocalFilePreview,
  LocalResourceLink,
  Resource,
} from '../shared/workspace';

export const textExtensions = new Set(
  '.txt .md .markdown .csv .tsv .json .jsonl .yaml .yml .toml .ini .log .py .js .mjs .cjs .ts .tsx .jsx .html .css .scss .sql .sh .zsh .tex .bib .rst .ipynb .c .cpp .h .hpp .java .go .rs .r .xml .svg'.split(
    ' ',
  ),
);
const imageTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const slashPath = (path: string) => path.split(sep).join('/');
const rootPath = (resource: Resource) =>
  resource.kind === 'folder' ? resolve(resource.path) : dirname(resolve(resource.path));

export function resolveResourcePath(
  resources: Resource[],
  resourceId: string,
  path: string,
): { resource: Resource; path: string } {
  const resource = resources.find((item) => item.id === resourceId);
  if (!resource) throw new Error('资料不存在，可能已移除，请重新关联。');
  if (resource.kind === 'link') throw new Error('网页资料请在浏览器中打开。');
  const root = rootPath(resource);
  const target = resolve(root, path || (resource.kind === 'file' ? basename(resource.path) : '.'));
  const child = relative(root, target);
  if (child === '..' || child.startsWith('..' + sep) || isAbsolute(child))
    throw new Error('只能读取已关联范围内的相对路径；链接指向关联范围以外，请先关联对应的文件夹。');
  return { resource, path: target };
}

function localError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') throw new Error('文件或文件夹已移动或删除，请刷新或重新关联。');
  if (code === 'EACCES' || code === 'EPERM')
    throw new Error('无法读取此位置，请检查文件访问权限。');
  if (code === 'ENOTDIR') throw new Error('这个位置不是文件夹，请刷新目录。');
  throw error;
}

function relativePath(resource: Resource, path: string) {
  return resource.kind === 'file' && resolve(resource.path) === path
    ? ''
    : slashPath(relative(rootPath(resource), path));
}

export class LocalFiles {
  constructor(private store: Pick<Store, 'workspace'>) {}

  resolvePath(resourceId: string, path: string) {
    return resolveResourcePath(this.store.workspace.resources, resourceId, path);
  }

  async getPath(resourceId: string, path: string) {
    const target = this.resolvePath(resourceId, path);
    await stat(target.path).catch(localError);
    return target.path;
  }

  async list(resourceId: string, path: string, offset = 0): Promise<LocalDirectory> {
    const target = this.resolvePath(resourceId, path);
    if (target.resource.kind !== 'folder') throw new Error('请选择已关联的文件夹。');
    const entries = (await readdir(target.path, { withFileTypes: true }).catch(localError)).sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN'),
    );
    return {
      name: basename(target.path),
      path: relativePath(target.resource, target.path),
      entries: entries.slice(offset, offset + 100).map((entry) => ({
        name: entry.name,
        path: slashPath(relative(rootPath(target.resource), resolve(target.path, entry.name))),
        kind: entry.isDirectory() ? 'folder' : 'file',
      })),
      total: entries.length,
      nextOffset: offset + 100 < entries.length ? offset + 100 : null,
    };
  }

  async read(resourceId: string, path: string): Promise<LocalFilePreview> {
    const target = this.resolvePath(resourceId, path);
    const info = await stat(target.path).catch(localError);
    if (!info.isFile()) throw new Error('请选择文件；文件夹可以在左侧展开。');
    const extension = extname(target.path).toLowerCase();
    const kind = ['.md', '.markdown'].includes(extension)
      ? 'markdown'
      : textExtensions.has(extension)
        ? 'text'
        : 'unsupported';
    if (kind !== 'unsupported' && info.size > 8 * 1024 * 1024)
      throw new Error('文件超过 8 MB，请使用系统应用打开；预览不会截断正文。');
    const body =
      kind === 'unsupported' ? '' : await readFile(target.path, 'utf8').catch(localError);
    return {
      name: basename(target.path),
      path: relativePath(target.resource, target.path),
      fullPath: target.path,
      kind,
      body,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  }

  async link(resourceId: string, path: string, href: string): Promise<LocalResourceLink> {
    if (/^https?:\/\//i.test(href)) return { kind: 'external', url: new URL(href).href };
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//'))
      throw new Error('暂不支持这种链接，请用系统应用打开文件。');
    const hash = href.indexOf('#');
    const source = hash === -1 ? href : href.slice(0, hash);
    const anchor = hash === -1 ? undefined : decodeURIComponent(href.slice(hash + 1));
    if (!source) return { kind: 'anchor', anchor: anchor ?? '' };
    const document = this.resolvePath(resourceId, path);
    const destination = resolve(dirname(document.path), decodeURIComponent(source.split('?')[0]));
    const next = slashPath(relative(rootPath(document.resource), destination));
    const target = this.resolvePath(resourceId, next);
    return {
      kind: 'file',
      path: relativePath(target.resource, target.path),
      ...(anchor ? { anchor } : {}),
    };
  }

  async image(resourceId: string, path: string, source: string): Promise<string> {
    if (/^https?:\/\//i.test(source)) throw new Error('网络图片请在浏览器中查看。');
    if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/i.test(source)) return source;
    const link = await this.link(resourceId, path, source);
    if (link.kind !== 'file') throw new Error('请选择本地图片。');
    const target = this.resolvePath(resourceId, link.path);
    const mime = imageTypes[extname(target.path).toLowerCase()];
    if (!mime) throw new Error('支持 PNG、JPEG、GIF、WebP 和 SVG 本地图片。');
    const info = await stat(target.path).catch(localError);
    if (!info.isFile()) throw new Error('图片链接没有指向文件。');
    if (info.size > 8 * 1024 * 1024) throw new Error('图片超过 8 MB，请使用系统应用查看。');
    const bytes = await readFile(target.path).catch(localError);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
}
