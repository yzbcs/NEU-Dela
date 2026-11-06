import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import type { ChatService } from './chat';
import { periodTimes } from '../shared/workspace';

const output = resolve('assets/output/settings-validation');
const query = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
const view = (name: string) => `[data-settings-page=${JSON.stringify(name)}]`;
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
async function text(window: BrowserWindow, selector: string) {
  return window.webContents.executeJavaScript(
    `${query(selector)}?.textContent || ''`,
  ) as Promise<string>;
}
async function click(window: BrowserWindow, selector: string) {
  await waitFor(() => exists(window, selector), selector);
  await window.webContents.executeJavaScript(`${query(selector)}.click()`);
}
function buttonCode(label: string, scope = 'body') {
  return `Array.from(${query(scope)}?.querySelectorAll('button')||[]).find(button=>button.textContent.trim()===${JSON.stringify(label)}&&!button.disabled)`;
}
async function button(window: BrowserWindow, label: string, scope = 'body') {
  const code = buttonCode(label, scope);
  await waitFor(() => window.webContents.executeJavaScript(`Boolean(${code})`), label);
  await window.webContents.executeJavaScript(`${code}.click()`);
}
async function fill(window: BrowserWindow, selector: string, value: string) {
  await waitFor(() => exists(window, selector), selector);
  await window.webContents.executeJavaScript(
    `(() => {const element=${query(selector)};const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
}
async function settle(window: BrowserWindow) {
  await window.webContents.executeJavaScript(
    'new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))',
  );
}
async function observations() {
  const response = await fetch(process.env.DOLA_SETTINGS_METRICS_URL!);
  return (await response.json()) as {
    modelRequests: number;
    lastModel: string | null;
    mailConnections: number;
    mailPort: number;
  };
}

export async function runSettingsSmoke(
  service: ChatService,
  window: BrowserWindow,
  restore = false,
) {
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, 'report.json');
  const previous = restore ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  const checks: string[] = previous?.checks ?? [];
  const screenshots: string[] = previous?.screenshots ?? [];
  const screenshotThemes: Record<string, string> = previous?.screenshotThemes ?? {};
  const record = (label: string) => {
    checks.push(label);
    console.log('settings: ' + label);
  };
  const waitForTheme = async (theme: 'light' | 'dark') => {
    await waitFor(
      async () =>
        service.store.theme === theme &&
        nativeTheme.themeSource === theme &&
        (await window.webContents.executeJavaScript('document.documentElement.dataset.theme')) ===
          theme,
      theme + ' 外观在存储、原生窗口与页面同步',
    );
  };
  const capture = async (name: string, theme: 'light' | 'dark' = 'light') => {
    await window.webContents.executeJavaScript(`window.dola.setTheme(${JSON.stringify(theme)})`);
    await waitForTheme(theme);
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: window.getContentBounds().width - 20,
      y: 20,
    });
    await settle(window);
    await window.webContents.executeJavaScript(
      `Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))).then(() => undefined)`,
    );
    await settle(window);
    // Give Electron's compositor time to publish the newly rendered page before capture.
    await new Promise((done) => setTimeout(done, 250));
    writeFileSync(join(output, name + '.png'), (await window.webContents.capturePage()).toPNG());
    screenshots.push(name + '.png');
    screenshotThemes[name + '.png'] = theme;
  };
  const saveReport = (passed: boolean, extra: Record<string, unknown> = {}) => {
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          passed,
          checks,
          screenshots,
          screenshotThemes,
          restartPassed: false,
          runtimeDirectory: service.store.dataDirectory,
          realApiRequests: 0,
          notificationBannerDeliveryTested: false,
          testData: 'isolated synthetic workspace; loopback model and mail connection fixtures',
          ...extra,
        },
        null,
        2,
      ) + '\n',
    );
  };
  async function overview() {
    await button(window, '设置');
    await waitFor(() => exists(window, view('overview')), '设置总览');
  }
  async function open(name: string) {
    await overview();
    await click(window, `[data-settings-target=${JSON.stringify(name)}]`);
    await waitFor(() => exists(window, view(name)), name + ' 设置页');
  }
  try {
    await waitFor(() => exists(window, '.dashboard-page'), '工作台首页加载');
    if (restore) {
      const fixture = previous.fixture;
      assert.equal(service.store.providers.length, 2);
      assert.equal(service.store.provider(fixture.providerA).name, '人工服务 A · 已保存');
      assert.equal(service.store.provider(fixture.providerA).model, 'settings-draft-model');
      assert.equal(service.store.provider(fixture.providerB).name, '人工服务 B');
      assert.equal(service.store.theme, 'light');
      assert.equal(service.store.workspace.degree, 'graduate');
      assert.equal(service.store.workspace.timetable.term, '2026 秋季 · 设置验证');
      assert.equal(service.store.workspace.timetable.firstMonday, '2026-08-31');
      assert.deepEqual(service.store.workspace.timetable.courses, fixture.courses);
      assert.equal(service.store.workspace.timetable.sourceName, '人工课表来源');
      assert.equal(service.store.workspace.timetable.sourcePath, 'fixture-source.pdf');
      assert.deepEqual(service.store.workspace.timetable.periods?.[0], ['08:20', '09:05']);
      assert.equal(service.store.workspace.mailAccounts.length, 1);
      assert(service.store.workspace.mailAccounts[0].hasPassword);
      const before = await observations();
      await overview();
      await open('models');
      assert((await text(window, view('models'))).includes('人工服务 A · 已保存'));
      await open('mail');
      await settle(window);
      const after = await observations();
      assert.equal(after.modelRequests, before.modelRequests);
      assert.equal(after.mailConnections, before.mailConnections);
      record(
        '重启后外观、身份、模型修改、邮箱配置与学期设置恢复，原课程和来源保留；进入设置仍不联网',
      );
      saveReport(true, { fixture, restartPassed: true });
      return;
    }

    const providerA = service.store.providers.find((provider) => provider.name === '人工服务 A')!;
    const providerB = service.store.providers.find((provider) => provider.name === '人工服务 B')!;
    assert(providerA && providerB);
    const courses = [
      {
        id: randomUUID(),
        name: '人工保留课程',
        day: 1,
        start: 1,
        end: 2,
        weeks: '1-16',
        location: '人工教室',
        teacher: '人工教师',
        detail: '设置验证保留课程',
      },
    ];
    service.store.workspace.timetable = {
      term: '人工原有学期',
      firstMonday: '2026-08-24',
      courses,
      sourceName: '人工课表来源',
      sourcePath: 'fixture-source.pdf',
      sourceUrl: 'https://example.org/fixture-course',
      periods: periodTimes.map(([start, end]) => [start, end]),
    };
    service.store.saveWorkspace();
    service.changed();
    const started = await observations();
    await overview();
    const summary = await text(window, view('overview'));
    for (const heading of ['通用', '模型与连接', '学习与提醒', '数据与帮助'])
      assert(summary.includes(heading));
    assert.equal(
      await window.webContents.executeJavaScript(
        `${query(view('overview'))}.querySelectorAll('[data-settings-target]').length`,
      ),
      10,
    );
    assert.equal(await exists(window, '.provider-form'), false);
    await settle(window);
    assert.deepEqual(await observations(), started);
    record('侧栏设置先显示四组十个入口和当前状态，不自动打开模型表单或发起模型、邮箱连接');

    await open('appearance');
    assert(
      await exists(
        window,
        `[data-theme-choice=${JSON.stringify(service.store.theme)}][aria-pressed="true"]`,
      ),
    );
    await click(window, '[data-theme-choice="light"]');
    await waitForTheme('light');
    await overview();
    await capture('settings-light');
    await open('appearance');
    await click(window, '[data-theme-choice="dark"]');
    await waitForTheme('dark');
    await overview();
    await capture('settings-dark', 'dark');
    window.setSize(1024, 700);
    await settle(window);
    assert(
      await window.webContents.executeJavaScript(
        `${query(view('overview'))}.scrollWidth <= ${query(view('overview'))}.clientWidth + 1`,
      ),
    );
    await capture('settings-compact', 'dark');
    window.setSize(1360, 900);
    await open('appearance');
    await click(window, '[data-theme-choice="light"]');
    await waitForTheme('light');
    await open('identity');
    assert(
      await exists(
        window,
        `[data-degree-choice=${JSON.stringify(service.store.workspace.degree)}][aria-pressed="true"]`,
      ),
    );
    await click(window, '[data-degree-choice="graduate"]');
    await waitFor(() => service.store.workspace.degree === 'graduate', '学习身份保存');
    await open('identity');
    assert(await exists(window, '[data-degree-choice="graduate"][aria-pressed="true"]'));
    record('外观与学习身份显示真实当前值并保存，设置总览在深浅主题和 1024×700 窗口无横向溢出');

    await open('models');
    assert.equal(await exists(window, '.provider-form'), false);
    const providerCard = (id: string) => `[data-provider-id=${JSON.stringify(id)}]`;
    await button(window, '编辑', providerCard(providerA.id));
    await waitFor(() => exists(window, view('model-editor')), '显式编辑模型');
    await fill(window, '.provider-form input[name="providerName"]', '人工服务 A · 已保存');
    if (!(await exists(window, '.provider-form input[name="model"]:not([type="hidden"])')))
      await button(window, '手动输入模型 ID');
    await fill(
      window,
      '.provider-form input[name="model"]:not([type="hidden"])',
      'settings-draft-model',
    );
    await capture('settings-editor');
    const beforeProbe = await observations();
    const savedSettings = readFileSync(join(service.store.dataDirectory, 'settings.json'), 'utf8');
    await button(window, '测试连接', '.provider-form');
    await waitFor(
      async () => (await observations()).modelRequests > beforeProbe.modelRequests,
      '实际本地模型探测',
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(${buttonCode('测试连接', '.provider-form')})`,
        ),
      '模型探测结束',
    );
    assert.equal((await observations()).lastModel, 'settings-draft-model');
    assert((await text(window, '.provider-form')).includes('连接测试通过'));
    assert.equal(service.store.provider(providerA.id).name, '人工服务 A');
    assert.equal(
      readFileSync(join(service.store.dataDirectory, 'settings.json'), 'utf8'),
      savedSettings,
    );
    assert(await exists(window, view('model-editor')));
    await button(window, '保存服务', '.provider-form');
    await waitFor(() => exists(window, view('models')), '保存后返回模型列表');
    assert.equal(service.store.provider(providerA.id).name, '人工服务 A · 已保存');
    assert.equal(service.store.provider(providerA.id).model, 'settings-draft-model');
    assert.equal((await observations()).modelRequests, beforeProbe.modelRequests + 1);
    await capture('settings-models');
    await button(window, '编辑', providerCard(providerB.id));
    await fill(window, '.provider-form input[name="providerName"]', '人工取消的修改');
    await button(window, '取消', '.provider-form');
    await waitFor(() => exists(window, view('models')), '取消返回模型列表');
    assert.equal(service.store.provider(providerB.id).name, '人工服务 B');
    record('模型列表显式编辑；连接测试使用当前草稿而不保存，保存不额外请求模型，取消保留原配置');

    const chatId = service.store.createChat(providerA.id, 'settings-draft-model');
    const chat = service.store.chat(chatId);
    chat.title = '人工设置验证对话';
    service.store.saveChats();
    service.changed();
    assert.notEqual(service.store.providers[0].id, providerA.id, '当前聊天服务应与列表首项不同');
    await button(window, chat.title);
    await fill(window, '.composer textarea', '这是一段尚未发送的学习安排草稿。');
    assert.equal(
      await exists(window, '.composer [role="switch"], .workspace-access, .workbench-toggle'),
      false,
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.composer button')).some(button=>/工作台已连接|工作台访问|连接工作台/.test(button.textContent))`,
      ),
      false,
    );
    await button(window, '模型设置');
    await waitFor(() => exists(window, view('models')), '聊天模型快捷入口');
    assert(await exists(window, `${providerCard(providerA.id)}[data-current-provider="true"]`));
    assert.equal(
      await exists(window, `${providerCard(providerB.id)}[data-current-provider="true"]`),
      false,
    );
    await button(window, '返回聊天');
    await waitFor(() => exists(window, '.composer textarea'), '返回原聊天');
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelector(".composer textarea").value',
      ),
      '这是一段尚未发送的学习安排草稿。',
    );
    assert.equal(chat.messages.length, 0);
    await capture('settings-chat');
    record(
      '聊天模型设置标记实际使用的非首项服务，返回保留草稿；聊天没有工作台连接开关，也没有自动发送',
    );

    await open('mail');
    assert.equal(service.store.workspace.mailAccounts.length, 0);
    const beforeMail = await observations();
    await button(window, '添加邮箱账号');
    await waitFor(() => exists(window, view('mail-editor')), '邮箱账号编辑');
    for (const [name, value] of Object.entries({
      mailName: '人工邮箱',
      mailEmail: 'student@example.org',
      mailUsername: 'student@example.org',
      mailPassword: 'fixture-mail-settings-password',
      imapHost: '127.0.0.1',
      smtpHost: '127.0.0.1',
      imapPort: String(beforeMail.mailPort),
      smtpPort: String(beforeMail.mailPort),
    }))
      await fill(window, `[name=${JSON.stringify(name)}]`, value);
    await button(window, '测试连接', view('mail-editor'));
    await waitFor(
      async () => (await observations()).mailConnections > beforeMail.mailConnections,
      '显式邮箱测试连接',
    );
    await waitFor(() => exists(window, '[role="alert"]'), '本地哨兵拒绝连接的错误反馈');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(${buttonCode('测试连接', view('mail-editor'))})`,
        ),
      '邮箱测试结束',
    );
    assert.equal(service.store.workspace.mailAccounts.length, 0);
    assert.equal(
      await window.webContents.executeJavaScript(`${query('[name="mailName"]')}.value`),
      '人工邮箱',
    );
    if (await exists(window, 'button[aria-label="关闭提示"]'))
      await click(window, 'button[aria-label="关闭提示"]');
    const testedMail = await observations();
    await button(window, '保存账号', view('mail-editor'));
    await waitFor(() => exists(window, view('mail')), '保存邮箱返回列表');
    assert.equal(service.store.workspace.mailAccounts.length, 1);
    await open('models');
    await open('mail');
    await settle(window);
    assert.equal((await observations()).mailConnections, testedMail.mailConnections);
    assert.equal(existsSync(join(service.store.dataDirectory, 'mail-cache')), false);
    record(
      '邮箱测试与保存独立：显式测试失败保留草稿且不保存；保存及重新进入账号设置不收信、不生成邮件缓存',
    );

    await open('semester');
    await button(window, '编辑学期设置');
    await waitFor(() => exists(window, view('semester-editor')), '学期设置编辑');
    await fill(window, '[name="term"]', '2026 秋季 · 设置验证');
    await fill(window, '[name="firstMonday"]', '2026-08-31');
    await fill(window, '[name="period-start-0"]', '08:20');
    await fill(window, '[name="period-end-0"]', '09:05');
    await button(window, '保存学期设置');
    await waitFor(
      () => service.store.workspace.timetable.term === '2026 秋季 · 设置验证',
      '学期设置已保存',
    );
    assert.deepEqual(service.store.workspace.timetable.courses, courses);
    assert.equal(service.store.workspace.timetable.sourceName, '人工课表来源');
    assert.equal(service.store.workspace.timetable.sourcePath, 'fixture-source.pdf');
    assert.equal(service.store.workspace.timetable.sourceUrl, 'https://example.org/fixture-course');
    assert.deepEqual(service.store.workspace.timetable.periods?.[0], ['08:20', '09:05']);
    record('学期与节次独立保存，原课程、导入来源和来源网址保持不变');

    await open('data');
    await waitFor(
      async () => (await text(window, view('data'))).includes(service.store.dataDirectory),
      '实际数据目录',
    );
    await open('about');
    await waitFor(
      async () => (await text(window, view('about'))).includes(app.getVersion()),
      '实际应用版本',
    );
    record('数据目录与关于页显示当前隔离实例的真实路径和实际运行版本');
    let reminderTriggers = 0;
    ipcMain.removeHandler('dola:workspace:testNotification');
    ipcMain.handle('dola:workspace:testNotification', () => {
      reminderTriggers++;
    });
    await open('reminders');
    await button(window, '发送测试提醒');
    await waitFor(() => reminderTriggers === 1, '提醒按钮触发通知接口');
    record('提醒页按钮触发通知接口；此项使用测试替身，未验证系统通知横幅');
    await button(window, '资料与笔记');
    await waitFor(() => exists(window, '.library-page'), '本地资料入口');
    assert(
      await window.webContents.executeJavaScript(
        `Boolean(${buttonCode('添加文件夹')}) && Boolean(${buttonCode('添加文件')})`,
      ),
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.library-page button')).some(button=>/关联文件夹|关联文件/.test(button.textContent))`,
      ),
      false,
    );
    record('资料页明确显示“添加文件夹”和“添加文件”，原文件浏览行为保留');
    saveReport(true, {
      fixture: { providerA: providerA.id, providerB: providerB.id, chatId, courses },
    });
  } catch (error) {
    saveReport(false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
