import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { ChatService } from './chat';

const output = resolve('assets/output/local-files-validation');
const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

async function waitFor(check: () => unknown | Promise<unknown>, label: string) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error('等待失败：' + label);
}
async function exists(window: BrowserWindow, selector: string) {
  return window.webContents.executeJavaScript(`Boolean(${query(selector)})`);
}
async function click(window: BrowserWindow, selector: string) {
  await waitFor(() => exists(window, selector), selector);
  await window.webContents.executeJavaScript(`${query(selector)}.click()`);
}
async function button(window: BrowserWindow, text: string) {
  const code = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
  await waitFor(() => window.webContents.executeJavaScript(`Boolean(${code})`), text);
  await window.webContents.executeJavaScript(`${code}.click()`);
}
async function fill(window: BrowserWindow, selector: string, value: string) {
  await waitFor(() => exists(window, selector), selector);
  await window.webContents.executeJavaScript(
    `(() => {const e=${query(selector)};const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
async function text(window: BrowserWindow, selector: string) {
  return window.webContents.executeJavaScript(
    `${query(selector)}?.textContent || ''`,
  ) as Promise<string>;
}
async function capture(window: BrowserWindow, name: string) {
  await new Promise((done) => setTimeout(done, 180));
  writeFileSync(join(output, name + '.png'), (await window.webContents.capturePage()).toPNG());
}

export async function runLocalFilesSmoke(
  service: ChatService,
  window: BrowserWindow,
  restore = false,
) {
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, 'report.json');
  const previous = restore ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  const checks: string[] = previous?.checks ?? [];
  const screenshots: string[] = previous?.screenshots ?? [];
  const record = (label: string) => {
    checks.push(label);
    console.log('local-files: ' + label);
  };
  const screenshot = async (name: string) => {
    await capture(window, name);
    screenshots.push(name + '.png');
  };
  const saveReport = (passed: boolean, extra: Record<string, unknown> = {}) => {
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          passed,
          checks,
          screenshots,
          restartPassed: false,
          runtimeDirectory: service.store.dataDirectory,
          realApiRequests: 0,
          testData: 'isolated synthetic local files; no real workspace data or model requests',
          ...extra,
        },
        null,
        2,
      ) + '\n',
    );
  };
  try {
    await waitFor(() => exists(window, '.dashboard-page'), '工作台加载');
    const directory = join(service.store.dataDirectory, 'fixture-files');
    const folder = join(directory, '课程资料');
    const filePath = '课程资料/阅读 笔记.md';
    const firstBody = [
      '# 人工课程阅读笔记',
      '',
      '这里记录检索与阅读。关键词用于文内查找，第二个关键词用于跳转。',
      '',
      '## 核心概念',
      '',
      '| 概念 | 说明 |',
      '| --- | --- |',
      '| 检索 | 找到相关资料 |',
      '',
      '```ts',
      'const course = "人工课程";',
      '```',
      '',
      '![本地图示](../图示.png)',
      '',
      '[继续阅读](第二篇.md#下一步)',
      '',
      '- [ ] 阅读清单仅展示，不在文件预览中修改原文',
      '',
    ].join('\n');
    let resourceId: string;
    if (restore) {
      resourceId = previous.resourceId;
      assert(service.store.workspace.resources.some((resource) => resource.id === resourceId));
    } else {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, '阅读 笔记.md'), firstBody);
      writeFileSync(
        join(folder, '第二篇.md'),
        '# 第二篇阅读\n\n## 下一步\n\n阅读已跳转到另一份真实 Markdown。\n',
      );
      writeFileSync(
        join(folder, '课堂记录.txt'),
        '这是普通 UTF-8 文本，原样显示。\n第二行记录课程要点。\n',
      );
      writeFileSync(join(folder, '附件.bin'), Buffer.from([0, 1, 2, 3]));
      writeFileSync(join(folder, '待移走.md'), '# 临时资料\n\n读取后模拟原文件被移走。\n');
      writeFileSync(
        join(directory, '图示.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      );
      resourceId = randomUUID();
      service.store.workspace.resources.push({
        id: resourceId,
        title: '人工课程资料',
        kind: 'folder',
        path: directory,
        category: '人工课程',
        addedAt: new Date().toISOString(),
      });
      service.store.saveWorkspace();
      service.changed();
    }
    const item = (path: string) =>
      `button[data-resource-id="${resourceId}"][data-path=${JSON.stringify(path)}]`;
    async function openLibrary() {
      await button(window, '资料与笔记');
      await waitFor(() => exists(window, '.library-page'), '资料页');
      await click(window, '.library-toolbar .segment-tabs button:last-child');
      await waitFor(() => exists(window, '.local-files-pane'), '本地资料工作区');
    }
    async function readFile(path: string, marker: string) {
      await click(window, item(path));
      await waitFor(
        () => text(window, '.local-file-reader').then((body) => body.includes(marker)),
        marker,
      );
    }
    await openLibrary();
    if (restore) {
      await waitFor(
        () => text(window, '.local-file-reader').then((body) => body.includes('外部修改后新段落')),
        '重启后恢复原文件',
      );
      assert(await exists(window, `.local-file-reader[data-path=${JSON.stringify(filePath)}]`));
      assert.equal(
        readFileSync(join(folder, '阅读 笔记.md'), 'utf8'),
        firstBody + '\n外部修改后新段落。\n',
      );
      record('重启后添加目录、上次阅读的文件与外部更新内容恢复，原文件未被预览改写');
      await screenshot('files-restored');
      saveReport(true, { resourceId, restartPassed: true });
      return;
    }

    await click(window, item(''));
    await click(window, item('课程资料'));
    await readFile(filePath, '人工课程阅读笔记');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.local-file-reader table') && document.querySelector('.local-file-reader pre code') && Array.from(document.querySelectorAll('.local-file-reader img')).some(img=>img.complete&&img.naturalWidth>0))`,
        ),
      'Markdown 表格代码和本地相对图片',
    );
    assert.equal(readFileSync(join(folder, '阅读 笔记.md'), 'utf8'), firstBody);
    record('逐级展开添加目录并阅读含中文空格文件名的 Markdown，表格、代码和相对本地图片显示');

    await window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.local-file-reader a')).find(link => link.textContent === '继续阅读').click()`,
    );
    await waitFor(
      () => text(window, '.local-file-reader').then((body) => body.includes('第二篇阅读')),
      '相对 Markdown 链接',
    );
    await readFile(filePath, '人工课程阅读笔记');
    record('相对 Markdown 链接打开同目录文件，可从目录返回原文');

    await button(window, '源码');
    await waitFor(
      () =>
        text(window, '.local-file-reader').then((body) =>
          body.includes('![本地图示](../图示.png)'),
        ),
      '完整 Markdown 源码',
    );
    await button(window, '预览');
    record('Markdown 预览与完整源码切换，源文件内容保持不变');

    await fill(window, 'input[aria-label="在当前文件中查找"]', '关键词');
    await waitFor(
      () => text(window, '.local-file-reader').then((body) => body.includes('1 / 2')),
      '文内查找结果',
    );
    await click(window, 'button[aria-label="下一个匹配"]');
    await waitFor(
      () => text(window, '.local-file-reader').then((body) => body.includes('2 / 2')),
      '跳到下一个匹配',
    );
    await fill(window, 'input[aria-label="在当前文件中查找"]', '');
    record('文内查找按当前文件正文返回匹配数量并能定位下一处');

    writeFileSync(join(folder, '阅读 笔记.md'), firstBody + '\n外部修改后新段落。\n');
    await click(window, 'button[aria-label="刷新资料"]');
    await waitFor(
      () => text(window, '.local-file-reader').then((body) => body.includes('外部修改后新段落')),
      '刷新读取外部修改',
    );
    record('文件在外部编辑后刷新读取最新原文，不依赖旧预览缓存');

    await readFile('课程资料/课堂记录.txt', '这是普通 UTF-8 文本');
    await readFile('课程资料/附件.bin', '使用系统应用查看此文件');
    assert(
      await window.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('.local-file-reader button')).some(button=>button.textContent.trim()==='用系统应用打开'&&!button.disabled)",
      ),
    );
    record('普通文本原样展示，暂不支持的格式给出系统应用打开入口');

    await readFile('课程资料/待移走.md', '临时资料');
    rmSync(join(folder, '待移走.md'));
    await click(window, 'button[aria-label="刷新资料"]');
    await waitFor(
      () => exists(window, '.local-file-reader [role="alert"]'),
      '原文件移走的可见错误',
    );
    await readFile(filePath, '人工课程阅读笔记');
    record('原文件移走后刷新显示明确错误，仍可继续打开其他资料');

    await click(window, 'button[aria-label="浅色模式"]');
    await waitFor(
      () =>
        window.webContents.executeJavaScript('document.documentElement.dataset.theme==="light"'),
      '浅色',
    );
    await screenshot('files-light');
    await click(window, 'button[aria-label="深色模式"]');
    await waitFor(
      () => window.webContents.executeJavaScript('document.documentElement.dataset.theme==="dark"'),
      '深色',
    );
    await screenshot('files-dark');
    // Compare the same page viewport; Windows adds a native title bar and menu.
    window.setContentSize(1024, 700);
    await new Promise((done) => setTimeout(done, 120));
    assert(
      await window.webContents.executeJavaScript(
        `(() => {const page=document.querySelector('.library-page');const pane=document.querySelector('.local-files-pane');return page.scrollWidth<=page.clientWidth+1&&pane.scrollWidth<=pane.clientWidth+1;})()`,
      ),
    );
    const readerHeight = await window.webContents.executeJavaScript(
      `document.querySelector('.local-reader-scroll').clientHeight`,
    );
    assert(readerHeight >= 250, `小窗口必须保留至少 250px 的正文阅读区域，实际 ${readerHeight}px`);
    await screenshot('files-compact');
    window.setContentSize(1360, 900);
    record(
      `本地资料在深浅主题与 1024×700 内容区域可读，正文高度 ${readerHeight}px，无整页横向溢出`,
    );

    const chatCount = service.store.chats.length;
    await button(window, '询问这份资料');
    await waitFor(() => exists(window, '.composer textarea'), '资料提问草稿');
    const prompt = await window.webContents.executeJavaScript(
      'document.querySelector(".composer textarea").value',
    );
    assert(prompt.includes(directory));
    assert(prompt.includes('阅读 笔记.md'));
    assert(prompt.includes(filePath));
    assert.equal(service.store.chats.length, chatCount);
    assert(
      !service.store.chats.some((chat) =>
        chat.messages.some((message) => message.state === 'streaming'),
      ),
    );
    record('询问资料准备包含实际资料位置和相对路径的草稿，不自动创建对话或发送模型请求');
    await screenshot('files-ai-draft');
    await openLibrary();
    await waitFor(
      () => text(window, '.local-file-reader').then((body) => body.includes('外部修改后新段落')),
      '返回保留阅读文件',
    );
    const sourceChatId = service.store.createChat();
    const sourceChat = service.store.chat(sourceChatId);
    sourceChat.title = '人工资料来源定位';
    sourceChat.messages.push({
      id: randomUUID(),
      role: 'assistant',
      text: '人工回复：来源指向已读取的原文件。',
      createdAt: new Date().toISOString(),
      state: 'complete',
      sources: [
        { kind: 'resource', id: resourceId, path: filePath, label: '阅读 笔记.md', citation: 1 },
      ],
    });
    service.store.saveChats();
    service.changed();
    await button(window, sourceChat.title);
    await click(window, '.message-sources button');
    await waitFor(
      () => exists(window, `.local-file-reader[data-path=${JSON.stringify(filePath)}]`),
      '聊天来源定位原文件',
    );
    await waitFor(
      () => text(window, '.local-file-reader').then((value) => value.includes('外部修改后新段落')),
      '来源读取最新文件',
    );
    record('聊天文件来源在本地阅读器定位实际相对路径并读取最新正文');

    await click(window, '.workspace-search-trigger');
    await fill(window, 'input[aria-label="搜索工作台内容"]', '人工课程资料');
    await click(window, `[data-search-kind="resource"][data-search-id="${resourceId}"]`);
    await waitFor(
      () => exists(window, '.local-file-reader[data-kind="folder"][data-path=""]'),
      '全局搜索进入添加目录',
    );
    await readFile(filePath, '外部修改后新段落');
    await click(window, '.workspace-search-trigger');
    await fill(window, 'input[aria-label="搜索工作台内容"]', '人工课程资料');
    await click(window, `[data-search-kind="resource"][data-search-id="${resourceId}"]`);
    await waitFor(
      () => exists(window, '.local-file-reader[data-kind="folder"][data-path=""]'),
      '重复搜索同一添加目录仍定位到目录',
    );
    record('全局搜索添加目录在应用内打开，随后可继续阅读其中的文件');

    const addedPath = join(directory, '新添加.md');
    writeFileSync(addedPath, '# 新添加的阅读资料\n');
    const originalOpen = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [addedPath],
    })) as typeof dialog.showOpenDialog;
    try {
      await button(window, '添加文件');
      await waitFor(
        () => text(window, '.local-file-reader').then((body) => body.includes('新添加的阅读资料')),
        '新添加文件立即阅读',
      );
    } finally {
      dialog.showOpenDialog = originalOpen;
    }
    await click(window, '.workspace-search-trigger');
    await fill(window, 'input[aria-label="搜索工作台内容"]', '人工课程资料');
    await click(window, `[data-search-kind="resource"][data-search-id="${resourceId}"]`);
    await waitFor(
      () => exists(window, '.local-file-reader[data-kind="folder"][data-path=""]'),
      '添加文件后搜索可以重新定位到其他资料',
    );
    await readFile(filePath, '外部修改后新段落');
    record('添加文件立即显示正文，随后全局搜索能切换到另一添加资料');
    assert.equal(
      readFileSync(join(folder, '阅读 笔记.md'), 'utf8'),
      firstBody + '\n外部修改后新段落。\n',
    );
    saveReport(true, { resourceId });
  } catch (error) {
    await capture(window, 'files-error').catch(() => {});
    saveReport(false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
