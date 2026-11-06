import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LocalFiles, resolveResourcePath } from '../src/main/local-files';
import { emptyWorkspace, type Workspace } from '../src/shared/workspace';

let directory: string;
let root: string;
let workspace: Workspace;
let files: LocalFiles;
const markdown =
  '# 课程资料\n\n| 章节 | 内容 |\n| --- | --- |\n| 第一章 | 引言 |\n\n![图](../图片/示意%20图.png)\n\n[下一章](第二章.md#重点)\n';

beforeEach(() => {
  mkdirSync(resolve('assets/output/test-state'), { recursive: true });
  directory = mkdtempSync(resolve('assets/output/test-state/local-files-'));
  root = join(directory, '课程资料');
  mkdirSync(join(root, '讲义'), { recursive: true });
  mkdirSync(join(root, '图片'));
  writeFileSync(join(root, '讲义', '第一章.md'), markdown);
  writeFileSync(join(root, '讲义', '第二章.md'), '# 第二章\n\n## 重点\n');
  writeFileSync(join(root, '图片', '示意 图.png'), Buffer.from([137, 80, 78, 71]));
  workspace = emptyWorkspace();
  workspace.resources = [
    {
      id: 'folder',
      title: '课程资料',
      kind: 'folder',
      path: root,
      category: '课程',
      addedAt: '2026-11-07',
    },
    {
      id: 'file',
      title: '第一章.md',
      kind: 'file',
      path: join(root, '讲义', '第一章.md'),
      category: '课程',
      addedAt: '2026-11-07',
    },
  ];
  files = new LocalFiles({ workspace });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('按级浏览并分页展示全部条目，子目录内容不会混进当前层级', async () => {
  for (let i = 0; i < 105; i++)
    writeFileSync(join(root, `资料-${String(i).padStart(3, '0')}.txt`), '资料');
  const first = await files.list('folder', '');
  expect(first.path).toBe('');
  expect(first.entries).toHaveLength(100);
  expect(first.entries.slice(0, 2).every((entry) => entry.kind === 'folder')).toBe(true);
  expect(first.entries.some((entry) => entry.name === '第一章.md')).toBe(false);
  const rest = await files.list('folder', '', first.nextOffset!);
  expect(rest.nextOffset).toBeNull();
  expect(new Set([...first.entries, ...rest.entries].map((entry) => entry.path)).size).toBe(107);
  const chapter = await files.list('folder', '讲义');
  expect(chapter.entries.map((entry) => entry.path).sort()).toEqual(
    ['讲义/第一章.md', '讲义/第二章.md'].sort(),
  );
});

it('Markdown 读取保留完整正文与原文件，外部修改后重新读取能看到更新', async () => {
  const first = await files.read('folder', '讲义/第一章.md');
  expect(first).toMatchObject({
    kind: 'markdown',
    name: '第一章.md',
    path: '讲义/第一章.md',
    body: markdown,
  });
  expect(first.fullPath).toBe(join(root, '讲义', '第一章.md'));
  expect(first.size).toBe(Buffer.byteLength(markdown));
  expect(Number.isNaN(Date.parse(first.modifiedAt))).toBe(false);
  expect(readFileSync(first.fullPath, 'utf8')).toBe(markdown);
  writeFileSync(first.fullPath, '# 外部新增内容\n');
  expect((await files.read('folder', first.path)).body).toBe('# 外部新增内容\n');
});

it('相对图片和文档链接从当前文档解析，支持中文、空格及标题锚点', async () => {
  const link = await files.link(
    'folder',
    '讲义/第一章.md',
    '%E7%AC%AC%E4%BA%8C%E7%AB%A0.md#%E9%87%8D%E7%82%B9',
  );
  expect(link).toEqual({ kind: 'file', path: '讲义/第二章.md', anchor: '重点' });
  const image = await files.image('folder', '讲义/第一章.md', '../图片/示意%20图.png');
  expect(image).toBe('data:image/png;base64,iVBORw==');
  expect(await files.link('folder', '讲义/第一章.md', '#重点')).toEqual({
    kind: 'anchor',
    anchor: '重点',
  });
  expect(await files.link('folder', '讲义/第一章.md', 'https://example.org/guide#lesson')).toEqual({
    kind: 'external',
    url: 'https://example.org/guide#lesson',
  });
});

it('单独关联文件的空路径指向原文，同目录链接与原文使用一致的解析规则', async () => {
  expect((await files.read('file', '')).body).toBe(markdown);
  expect((await files.read('file', '')).path).toBe('');
  const link = await files.link('file', '', '第二章.md');
  expect(link).toEqual({ kind: 'file', path: '第二章.md' });
  expect((await files.read('file', '第二章.md')).body).toContain('# 第二章');
  expect(resolveResourcePath(workspace.resources, 'file', '第二章.md').path).toBe(
    join(root, '讲义', '第二章.md'),
  );
  expect(await files.link('file', '第二章.md', '第一章.md')).toEqual({ kind: 'file', path: '' });
});

it('文本完整显示，不支持的格式返回元信息，大文件明确提示而非截断', async () => {
  writeFileSync(join(root, '脚本.py'), 'print("课程资料")\n');
  writeFileSync(join(root, '讲义.pdf'), Buffer.from('%PDF-fixture'));
  writeFileSync(join(root, '大文件.md'), Buffer.alloc(8 * 1024 * 1024 + 1, 65));
  expect(await files.read('folder', '脚本.py')).toMatchObject({
    kind: 'text',
    body: 'print("课程资料")\n',
  });
  expect(await files.read('folder', '讲义.pdf')).toMatchObject({
    kind: 'unsupported',
    body: '',
    size: 12,
  });
  await expect(files.read('folder', '大文件.md')).rejects.toThrow('超过 8 MB');
});

it('移动文件、移除关联与目录误选给出可操作提示', async () => {
  await expect(files.read('folder', '讲义')).rejects.toThrow('请选择文件');
  rmSync(join(root, '讲义', '第二章.md'));
  await expect(files.getPath('folder', '讲义/第二章.md')).rejects.toThrow('已移动或删除');
  await expect(files.list('folder', '不存在的目录')).rejects.toThrow('已移动或删除');
  workspace.resources = [];
  await expect(files.read('folder', '讲义/第一章.md')).rejects.toThrow('已移除');
});

it('越出已关联目录的文档链接提示补充关联，网络图片提示用浏览器查看', async () => {
  await expect(files.link('folder', '讲义/第一章.md', '../../其他项目/README.md')).rejects.toThrow(
    '资料范围以外',
  );
  await expect(
    files.image('folder', '讲义/第一章.md', 'https://example.org/image.png'),
  ).rejects.toThrow('网络图片');
});
