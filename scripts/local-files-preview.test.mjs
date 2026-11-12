import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LocalFiles } from '../src/main/local-files.ts';
import { ReadingAnnotations } from '../src/main/reading-annotations.ts';

test('PDF and Markdown resources can be read from files and folders', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'neu-local-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const markdownPath = join(directory, '课程.MD');
  const pdfPath = join(directory, '论文.PDF');
  const markdown = '# 课程笔记\n\n[阅读论文](论文.PDF)\n';
  const pdf = Buffer.from('%PDF-1.7\nexample\n%%EOF');
  await writeFile(markdownPath, markdown);
  await writeFile(pdfPath, pdf);
  const resources = [
    { id: 'markdown', kind: 'file', path: markdownPath },
    { id: 'pdf', kind: 'file', path: pdfPath },
    { id: 'folder', kind: 'folder', path: directory },
  ];
  const files = new LocalFiles({ workspace: { resources } });

  const note = await files.read('markdown', '');
  assert.equal(note.kind, 'markdown');
  assert.equal(note.body, markdown);
  assert.deepEqual(await files.link('markdown', '', '论文.PDF'), {
    kind: 'file',
    path: '论文.PDF',
  });
  for (const [id, relativePath] of [
    ['pdf', ''],
    ['folder', '论文.PDF'],
  ]) {
    const preview = await files.read(id, relativePath);
    assert.equal(preview.kind, 'pdf');
    assert.equal(preview.body, '');
    assert.deepEqual(Buffer.from(preview.data), pdf);
  }
  await assert.rejects(files.read('folder', '../outside.pdf'), /资料范围/);
});

test('large PDF files fail with a clear size limit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'neu-local-preview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdfPath = join(directory, 'large.pdf');
  await writeFile(pdfPath, '');
  await truncate(pdfPath, 50 * 1024 * 1024 + 1);
  const files = new LocalFiles({
    workspace: { resources: [{ id: 'pdf', kind: 'file', path: pdfPath }] },
  });
  await assert.rejects(files.read('pdf', ''), /PDF 超过 50 MB/);
});

test('annotations persist separately, support edits and detect changed source files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'neu-reading-annotations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdfPath = join(directory, 'paper.pdf');
  const original = '%PDF-1.7\noriginal\n%%EOF';
  await writeFile(pdfPath, original);
  const id = '9b34ef5c-a714-4c72-9373-fc443f52a6c3';
  const files = new LocalFiles({ workspace: { resources: [{ id, kind: 'file', path: pdfPath }] } });
  const annotations = new ReadingAnnotations(join(directory, 'annotations'), files);
  const initial = await annotations.list(id, '');
  const added = await annotations.add(id, '', initial.version, {
    text: 'Original paragraph',
    color: 'yellow',
    view: 'pdf',
    page: 1,
    rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
  });
  assert.equal(added.items.length, 1);
  const annotationId = added.items[0].id;
  const edited = await annotations.update(id, '', annotationId, 'green', 'My comment');
  assert.equal(edited.items[0].comment, 'My comment');
  assert.equal(edited.items[0].color, 'green');
  assert.equal(await readFile(pdfPath, 'utf8'), original);
  assert.deepEqual((await annotations.list(id, '')).items, edited.items);
  await writeFile(pdfPath, original + '\nchanged');
  const changed = await annotations.list(id, '');
  assert.notEqual(changed.version, changed.items[0].version);
  await assert.rejects(
    annotations.add(id, '', initial.version, {
      text: 'stale',
      color: 'yellow',
      view: 'pdf',
      page: 1,
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    }),
    /文件已经更改/,
  );
  assert.equal((await annotations.remove(id, '', annotationId)).items.length, 0);
});
