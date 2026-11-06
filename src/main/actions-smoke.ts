import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import type { ChatService } from './chat';
import type { WorkspaceCreation } from '../shared/types';

const output = resolve('assets/output/actions-validation');
async function waitFor(check: () => unknown | Promise<unknown>, label: string) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  }
  throw new Error('等待失败：' + label);
}
const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
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
async function capture(window: BrowserWindow, name: string) {
  await new Promise((resolveFrame) => setTimeout(resolveFrame, 200));
  writeFileSync(join(output, name + '.png'), (await window.webContents.capturePage()).toPNG());
}
function title(creation: WorkspaceCreation) {
  return creation.kind === 'course' ? creation.record.name : creation.record.title;
}

export async function runActionsSmoke(
  service: ChatService,
  window: BrowserWindow,
  openTodo: (id: string) => void,
  restore = false,
) {
  mkdirSync(output, { recursive: true });
  await waitFor(() => exists(window, '.dashboard-page'), '真实首页加载');
  const record = (label: string) => {
    checks.push(label);
    console.log('actions: ' + label);
  };
  const checks: string[] = restore
    ? JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')).checks
    : [];
  if (restore) {
    const creations = service.store.chats.flatMap((chat) =>
      chat.messages.flatMap((message) => message.creations ?? []),
    );
    assert(creations.some((creation) => creation.kind === 'note' && creation.status === 'undone'));
    assert(creations.some((creation) => creation.kind === 'todo' && creation.status === 'created'));
    const original = service.store.chats.find((chat) =>
      chat.messages[0]?.text.includes('[create-workspace]'),
    )!;
    await button(window, original.title);
    await waitFor(() => exists(window, '.creation-card'), '重启后的创建卡片');
    assert(
      (await window.webContents.executeJavaScript(
        'document.querySelectorAll(".creation-card").length',
      )) >= 3,
    );
    assert.equal(service.store.workspace.timetable.sourceName, '人工原有课表');
    record('重启后新增记录、撤销状态、聊天结果卡与原课表来源均保留');
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    Object.assign(report, { checks, restartPassed: true });
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return;
  }

  let releaseLoad: (() => void) | undefined;
  try {
    ipcMain.removeHandler('dola:load');
    const loading = new Promise<void>((resolveLoad) => {
      releaseLoad = resolveLoad;
    });
    ipcMain.handle('dola:load', async () => {
      await loading;
      return service.store.snapshot();
    });
    window.webContents.reload();
    await waitFor(() => exists(window, '.startup-screen'), '加载页');
    assert.equal(await exists(window, '.dashboard-page'), false, '加载时不显示空首页');
    await capture(window, 'startup');
    releaseLoad!();
    await waitFor(() => exists(window, '.dashboard-page'), '数据就绪后进入首页');
    record('加载过程中只显示品牌状态，数据就绪后进入真实首页');
    ipcMain.removeHandler('dola:load');
    let failNext = true;
    ipcMain.handle('dola:load', () => {
      if (failNext) {
        failNext = false;
        throw new Error('人工验证：暂时无法读取工作台');
      }
      return service.store.snapshot();
    });
    window.webContents.reload();
    await waitFor(() => exists(window, '.startup-screen[data-state="error"]'), '可重试的启动失败');
    await capture(window, 'startup-error');
    await button(window, '重新加载');
    await waitFor(() => exists(window, '.dashboard-page'), '启动重试成功');
    record('读取失败显示持久错误与重试入口，重试可恢复工作台');
  } finally {
    releaseLoad?.();
    ipcMain.removeHandler('dola:load');
    ipcMain.handle('dola:load', () => service.store.snapshot());
  }

  service.store.workspace.timetable = {
    term: '人工测试学期',
    firstMonday: '2026-08-31',
    sourcePath: '',
    sourceName: '人工原有课表',
    courses: [
      {
        id: randomUUID(),
        name: '原有课程',
        day: 1,
        start: 1,
        end: 2,
        weeks: '1-16',
        location: '原教室',
        teacher: '',
        detail: '',
      },
    ],
  };
  service.store.saveWorkspace();
  service.changed();
  async function send(prompt: string, finish = true) {
    await button(window, '开启新对话');
    await fill(window, '.composer textarea', prompt);
    await click(window, 'button[aria-label="发送消息"]:not(:disabled)');
    await waitFor(
      () => service.store.chats.some((chat) => chat.messages[0]?.text === prompt),
      '创建对话',
    );
    const chat = service.store.chats.find((chat) => chat.messages[0]?.text === prompt)!;
    if (finish) await waitFor(() => chat.messages.at(-1)?.state !== 'streaming', '工具及回复完成');
    return chat;
  }
  const chat = await send('请添加便利贴、课程和笔记 [create-workspace]');
  const reply = chat.messages.at(-1)!;
  assert.equal(reply.state, 'complete');
  assert.equal(reply.creations?.length, 3);
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelectorAll(".creation-card").length===3',
      ),
    '三张创建结果卡',
  );
  assert(service.store.workspace.timetable.courses.some((course) => course.name === '原有课程'));
  assert.equal(service.store.workspace.timetable.sourceName, '人工原有课表');
  record('通过聊天发送真实本机HTTP工具请求，创建三类记录并显示真实回执，保留原课表');
  await click(window, 'button[aria-label="浅色模式"]');
  await waitFor(
    () => window.webContents.executeJavaScript('document.documentElement.dataset.theme==="light"'),
    '浅色主题',
  );
  await capture(window, 'created-light');
  await click(window, 'button[aria-label="深色模式"]');
  await waitFor(() => nativeTheme.themeSource === 'dark', '深色主题');
  await capture(window, 'created-dark');
  window.setSize(1024, 700);
  assert(
    await window.webContents.executeJavaScript(
      'document.querySelector(".chat-scroll").scrollWidth<=document.querySelector(".chat-scroll").clientWidth',
    ),
  );
  await capture(window, 'created-compact');
  window.setSize(1360, 900);
  await click(window, 'button[aria-label="浅色模式"]');
  record('结果卡在深浅外观和1024×700小窗口完整显示，无横向溢出');

  const todo = reply.creations!.find((creation) => creation.kind === 'todo')!;
  const note = reply.creations!.find((creation) => creation.kind === 'note')!;
  const course = reply.creations!.find((creation) => creation.kind === 'course')!;
  await click(window, `button[aria-label="查看记录 ${title(todo)}"]`);
  await waitFor(() => exists(window, 'input[name=todoTitle]'), '定位新增便利贴');
  await fill(window, 'input[name=todoTitle]', title(todo) + '（已编辑）');
  await button(window, '保存便利贴');
  await button(window, chat.title);
  await click(window, `button[aria-label="撤销新增 ${title(todo)}"]`);
  await waitFor(
    () => window.webContents.executeJavaScript('document.body.textContent.includes("已被修改")'),
    '已编辑记录拒绝撤销',
  );
  assert(
    service.store.workspace.todos.some(
      (item) => item.id === todo.record.id && item.title.endsWith('（已编辑）'),
    ),
  );
  record('从结果卡定位并修改便利贴，撤销不会删除后续编辑内容');
  await click(window, `button[aria-label="撤销新增 ${title(note)}"]`);
  await waitFor(() => note.status === 'undone', '撤销新增笔记');
  assert(!service.store.workspace.notes.some((item) => item.id === note.record.id));
  record('撤销新增笔记同步移除记录并保留已撤销的聊天回执');
  await click(window, `button[aria-label="查看记录 ${title(course)}"]`);
  await waitFor(() => exists(window, '.course-detail'), '课程详情');
  await button(window, '编辑课程');
  await waitFor(() => exists(window, '.course-editor'), '进入课表编辑器');
  await click(window, 'button[aria-label="关闭弹窗"]');
  record('课程结果卡打开对应课程，并可进入已有课表编辑器');

  await button(window, '工作台首页');
  window.hide();
  openTodo(todo.record.id);
  await waitFor(
    () => window.isVisible() && exists(window, 'input[name=todoTitle]'),
    '提醒点击唤起并定位',
  );
  const before = service.store.workspace.todos.find((item) => item.id === todo.record.id)!.dueAt;
  await button(window, '推迟10分钟');
  await waitFor(
    () =>
      service.store.workspace.todos.find((item) => item.id === todo.record.id)!.dueAt !== before,
    '推迟保存',
  );
  openTodo(todo.record.id);
  await waitFor(() => exists(window, 'input[name=todoTitle]'), '再次打开同一事项');
  await button(window, '完成待办');
  await waitFor(
    () => service.store.workspace.todos.find((item) => item.id === todo.record.id)?.done,
    '完成事项',
  );
  openTodo(todo.record.id);
  await waitFor(() => exists(window, 'input[name=todoTitle]'), '恢复入口');
  await button(window, '恢复待办');
  await waitFor(
    () => service.store.workspace.todos.find((item) => item.id === todo.record.id)?.done === false,
    '恢复待办',
  );
  record('通知点击的同一导航处理唤起隐藏窗口并定位事项，可推迟、完成和恢复；未断言系统横幅送达');

  const failed = await send('请添加便利贴 [write-then-fail]');
  assert.equal(failed.messages.at(-1)?.state, 'error');
  assert(failed.messages.at(-1)?.creations?.length);
  await waitFor(() => exists(window, '.creation-card'), '失败回复保留真实创建卡');
  await capture(window, 'created-then-error');
  record('保存成功后模型续接失败，实际记录与成功卡片仍保留');
  const stopped = await send('请添加便利贴 [write-slow]', false);
  await waitFor(() => stopped.messages.at(-1)?.creations?.length, '停止前保存完成');
  await click(window, 'button[aria-label="停止生成"]');
  await waitFor(() => stopped.messages.at(-1)?.state === 'stopped', '停止生成');
  assert(stopped.messages.at(-1)?.creations?.length);
  record('保存后停止生成保留真实记录与回执，停止不等于撤销');
  writeFileSync(
    join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        screenshots: [
          'startup.png',
          'startup-error.png',
          'created-light.png',
          'created-dark.png',
          'created-compact.png',
          'created-then-error.png',
        ],
        runtimeDirectory: service.store.dataDirectory,
        realApiRequests: 0,
        notificationBannerDeliveryTested: false,
      },
      null,
      2,
    ) + '\n',
  );
}
