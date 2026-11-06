import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';
import type { ChatService } from './chat';
import type { Chat } from '../shared/types';
import { addDays, chinaDate, dateNumber, periodTimes, type Workspace } from '../shared/workspace';

const output = resolve('assets/output/design-validation');
async function waitFor(check: () => Promise<unknown> | unknown, label: string) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error('设计验证等待失败：' + label);
}
const select = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
async function exists(window: BrowserWindow, selector: string) {
  return window.webContents.executeJavaScript(`Boolean(${select(selector)})`);
}
async function click(window: BrowserWindow, selector: string) {
  await waitFor(() => exists(window, selector), selector);
  await window.webContents.executeJavaScript(`${select(selector)}.click()`);
}
async function button(window: BrowserWindow, text: string) {
  const expression = `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)})`;
  await waitFor(
    () => window.webContents.executeJavaScript(`Boolean(${expression})`),
    '按钮 ' + text,
  );
  await window.webContents.executeJavaScript(`${expression}.click()`);
}
async function fill(window: BrowserWindow, selector: string, value: string) {
  await waitFor(() => exists(window, selector), selector);
  await window.webContents.executeJavaScript(`(() => {
    const input=${select(selector)};
    const prototype=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
async function setTheme(window: BrowserWindow, theme: 'light' | 'dark') {
  await window.webContents.executeJavaScript(`window.dola.setTheme(${JSON.stringify(theme)})`);
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        `document.documentElement.dataset.theme===${JSON.stringify(theme)}`,
      ),
    '主题 ' + theme,
  );
}
async function capture(window: BrowserWindow, name: string, layouts: Record<string, unknown>) {
  const geometry = `(() => ({
    theme:document.documentElement.dataset.theme,
    rendererNow:new Date().toISOString(),
    viewport:{width:innerWidth,height:innerHeight},
    surfaces:['.work-header','.dashboard-focus','.dashboard-stats','.dashboard-stat','.agenda-days button:nth-child(2)', '.theme-switcher button[aria-label="跟随系统"]','.chat-header','.work-modal'].flatMap(selector=>{
      const node=document.querySelector(selector); if(!node)return [];
      const bounds=node.getBoundingClientRect(),style=getComputedStyle(node);
      return [{selector,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,background:style.backgroundColor,opacity:style.opacity,
        animations:node.getAnimations().map(animation=>({currentTime:animation.currentTime,playState:animation.playState}))}];
    }),
    scrolls:Array.from(document.querySelectorAll('.app-shell,.main,.work-page,.chat-scroll,.settings-page')).map(node=>({className:node.className,top:node.scrollTop,left:node.scrollLeft}))
  }))()`;
  const before = await window.webContents.executeJavaScript(geometry);
  // 等有限的入场动画和主题过渡完成，避免截取动画中的颜色与位置。
  await window.webContents.executeJavaScript(
    `Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))`,
  );
  await window.webContents.executeJavaScript(`(() => {
    document.scrollingElement?.scrollTo({top:0,left:0,behavior:'instant'});
    document.querySelectorAll('.app-shell,.main,.work-page,.chat-scroll,.settings-page').forEach(node=>node.scrollTo({top:0,left:0,behavior:'instant'}));
    return new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  })()`);
  let stable = '',
    repetitions = 0;
  await waitFor(async () => {
    const next = JSON.stringify(await window.webContents.executeJavaScript(geometry));
    repetitions = next === stable ? repetitions + 1 : 0;
    stable = next;
    return repetitions >= 2;
  }, '截图布局与主题颜色稳定');
  const after = JSON.parse(stable);
  assert(
    after.scrolls.every((item: { top: number; left: number }) => item.top === 0 && item.left === 0),
    '截图页面滚动复位',
  );
  const header = after.surfaces.find(
    (item: { selector: string }) => item.selector === '.work-header',
  );
  if (header)
    assert(
      header.y >= 0 && header.y + header.height <= after.viewport.height,
      '页面标题在截图可视区域内',
    );
  layouts[name] = { before, after };
  const filename = name + '.png';
  writeFileSync(join(output, filename), (await window.webContents.capturePage()).toPNG());
  return filename;
}
async function closeModal(window: BrowserWindow) {
  await click(window, 'button[aria-label="关闭弹窗"]');
  await waitFor(
    () => window.webContents.executeJavaScript(`!document.querySelector('[role=dialog]')`),
    '关闭弹窗',
  );
}

export async function runDesignSmoke(service: ChatService, window: BrowserWindow) {
  assert(process.env.DOLA_DATA_DIR, '请通过 npm run smoke:design 创建隔离目录后运行设计验证');
  mkdirSync(output, { recursive: true });
  const original = {
    workspace: structuredClone(service.store.workspace),
    chats: structuredClone(service.store.chats),
    theme: service.store.theme,
  };
  const today = chinaDate();
  const tomorrow = addDays(today, 1);
  const day = ((new Date(dateNumber(today)).getUTCDay() + 6) % 7) + 1;
  const fixtureNow = today + 'T09:05:00+08:00';
  const firstCourseId = randomUUID(),
    secondCourseId = randomUUID(),
    noteId = randomUUID();
  const chat: Chat = {
    id: randomUUID(),
    title: '机器学习 · 课程复习',
    providerId: null,
    model: '',
    updatedAt: fixtureNow,
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        text: '怎样整理这周的课程笔记？',
        createdAt: fixtureNow,
        state: 'complete',
      },
      {
        id: randomUUID(),
        role: 'assistant',
        text: '先记下一个最想弄清楚的问题，再用自己的例子解释。\n\n这是用于界面验证的人工对话，没有调用模型。',
        createdAt: fixtureNow,
        state: 'complete',
      },
    ],
  };
  const workspace: Workspace = {
    ...original.workspace,
    timetable: {
      term: '秋季学期 · 设计演示',
      firstMonday: addDays(today, 1 - day),
      sourcePath: '',
      sourceName: '人工课程',
      periods: periodTimes.map(([start, end]): [string, string] => [start, end]),
      courses: [
        {
          id: firstCourseId,
          name: '机器学习',
          day,
          start: 1,
          end: 2,
          weeks: '1-16',
          location: '信息楼 302',
          teacher: '课程教师',
          detail: '阅读本周讲义，整理泛化误差与正则化的关系。',
        },
        {
          id: secondCourseId,
          name: '学术英语',
          day: (day % 7) + 1,
          start: 3,
          end: 4,
          weeks: '1-16',
          location: '文法楼 105',
          teacher: '课程教师',
          detail: '带上阅读笔记。',
        },
        {
          id: randomUUID(),
          name: '数据结构',
          day: ((day + 2) % 7) + 1,
          start: 5,
          end: 6,
          weeks: '1-16',
          location: '计算中心 201',
          teacher: '课程教师',
          detail: '',
        },
      ],
    },
    todos: [
      {
        id: randomUUID(),
        title: '补完实验报告的讨论部分',
        detail: '把观察到的现象和原因分别写清楚。',
        color: 'yellow',
        dueAt: today + 'T20:00:00+08:00',
        reminder: false,
        repeat: 'none',
        done: false,
        notifiedAt: '',
        createdAt: fixtureNow,
      },
      {
        id: randomUUID(),
        title: '带上英语课阅读笔记',
        detail: '',
        color: 'blue',
        dueAt: tomorrow + 'T10:00:00+08:00',
        reminder: false,
        repeat: 'none',
        done: false,
        notifiedAt: '',
        createdAt: fixtureNow,
      },
    ],
    notes: [
      {
        id: noteId,
        title: '正则化：让模型记住规律',
        category: '机器学习',
        body: '# 今天的一个问题\n\n为什么更小的训练误差，不一定带来更好的预测？\n\n## 我的理解\n\n用一个简单模型与一个复杂模型比较，分别记录训练表现和新样本表现。\n\n- [ ] 补充一个具体例子\n- [ ] 复习课程讲义',
        updatedAt: fixtureNow,
      },
      {
        id: randomUUID(),
        title: '下周阅读计划',
        category: '随手备忘',
        body: '先读摘要与图表，再整理两个值得讨论的问题。',
        updatedAt: fixtureNow,
      },
    ],
    notebooks: ['机器学习', '随手备忘'],
    resources: [],
    mailAccounts: [],
  };
  const checks: string[] = [],
    screenshots: string[] = [],
    networkRequests: string[] = [];
  const screenshotLayouts: Record<string, unknown> = {};
  const focusBranches: unknown[] = [];
  const focusSnapshot = () =>
    window.webContents.executeJavaScript(`(() => {
      const focus=document.querySelector('.dashboard-focus'); if(!focus)return null;
    return {kind:focus.dataset.focusKind,label:focus.querySelector('.dashboard-focus-label').textContent,title:focus.querySelector('.dashboard-focus-copy > strong').textContent,action:focus.querySelector('.dashboard-focus-action').textContent};
  })()`);
  let clockScript = '';
  let rendererNow = '';
  let reducedMotion: unknown;
  const record = (check: string) => {
    checks.push(check);
    console.log('design: ' + check);
  };
  try {
    assert.equal(service.store.providers.length, 0, '设计验证不配置模型服务');
    assert.equal(original.workspace.mailAccounts.length, 0, '设计验证使用空白隔离账号目录');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(window.dola && document.querySelector('.dashboard-page'))`,
        ),
      '应用加载',
    );
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, done) => {
        networkRequests.push(details.url);
        done({ cancel: true });
      },
    );
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.enable');
    const added = await window.webContents.debugger.sendCommand(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: `(() => { const RealDate=Date; const now=${JSON.stringify(new Date(fixtureNow).getTime())}; globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }; })()`,
      },
    );
    clockScript = added.identifier;
    service.store.workspace = workspace;
    service.store.chats = [chat];
    service.store.saveWorkspace();
    service.store.saveChats();
    await new Promise<void>((done) => {
      window.webContents.once('did-finish-load', () => done());
      window.webContents.reload();
    });
    rendererNow = await window.webContents.executeJavaScript('new Date().toISOString()');
    assert.equal(
      rendererNow,
      new Date(fixtureNow).toISOString(),
      'renderer 时钟必须精确使用人工时间',
    );
    record('renderer 时钟精确固定为人工北京时间 09:05');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `document.querySelector('.dashboard-focus')?.textContent.includes('机器学习')`,
        ),
      '首页当前课程焦点',
    );
    window.setSize(1360, 900);
    assert(await exists(window, '.dashboard-focus[data-focus-kind="course"]'));
    assert.equal(
      await window.webContents.executeJavaScript(`${select('.dashboard-focus-label')}.textContent`),
      '正在进行',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        `${select(`[data-agenda-course="${firstCourseId}"] .agenda-course-status`)}.textContent`,
      ),
      '上课中',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.dashboard-stat').length`,
      ),
      4,
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.dashboard-schedule,.dashboard-course-list').length`,
      ),
      0,
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.dashboard-agenda').length`,
      ),
      1,
    );
    assert(
      await window.webContents.executeJavaScript(`(() => {
      const focus=document.querySelector('.dashboard-focus').getBoundingClientRect();
      const agenda=document.querySelector('.dashboard-agenda').getBoundingClientRect();
      const stats=Array.from(document.querySelectorAll('.dashboard-stat'));
      return focus.top < agenda.top && stats.every(node=>node.getBoundingClientRect().height < 110);
    })()`),
      '首页先显示下一步，统计保持紧凑',
    );
    record('首页突出当前课程，保留四项紧凑统计与唯一课程日程');
    focusBranches.push({ branch: 'ongoing-course', ...(await focusSnapshot()) });
    const futureTask = structuredClone(workspace);
    futureTask.timetable.courses = futureTask.timetable.courses.filter(
      (course) => course.id !== firstCourseId,
    );
    service.store.workspace = futureTask;
    service.store.saveWorkspace();
    service.changed();
    await waitFor(
      () => exists(window, '.dashboard-focus[data-focus-kind="todo"]'),
      '没有正在上课时显示最近的定时待办',
    );
    const timed = await focusSnapshot();
    assert.equal(timed.title, futureTask.todos[0].title);
    assert.equal(timed.label, '接下来');
    await click(window, '.dashboard-focus-action');
    await waitFor(() => exists(window, 'input[name=todoTitle]'), '焦点待办可打开');
    assert.equal(
      await window.webContents.executeJavaScript(`${select('input[name=todoTitle]')}.value`),
      futureTask.todos[0].title,
    );
    await closeModal(window);
    focusBranches.push({ branch: 'future-timed-todo', ...timed });
    record('没有正在上课时优先展示最近的定时待办，并打开对应记录');
    const emptySchedule = structuredClone(workspace);
    emptySchedule.timetable.courses = [];
    emptySchedule.todos = [];
    service.store.workspace = emptySchedule;
    service.store.saveWorkspace();
    service.changed();
    await waitFor(
      () => exists(window, '.dashboard-focus[data-focus-kind="empty"]'),
      '没有未来定时安排',
    );
    const emptyFocus = await focusSnapshot();
    assert.equal(emptyFocus.title, '未来七天暂时没有定时安排');
    assert.equal(emptyFocus.action, '记一件事');
    await click(window, '.dashboard-focus-action');
    await waitFor(() => exists(window, 'input[name=todoTitle]'), '无定时安排可新建待办');
    await closeModal(window);
    focusBranches.push({ branch: 'no-future-arrangement', ...emptyFocus });
    const missingTerm = structuredClone(workspace);
    missingTerm.timetable.firstMonday = '';
    missingTerm.todos = [];
    service.store.workspace = missingTerm;
    service.store.saveWorkspace();
    service.changed();
    await waitFor(
      async () => (await focusSnapshot())?.title === '把第一份安排带进来',
      '未配置学期首周的引导',
    );
    const missingFocus = await focusSnapshot();
    assert.equal(missingFocus.kind, 'empty');
    assert.equal(missingFocus.action, '设置课表');
    await click(window, '.dashboard-focus-action');
    await waitFor(() => exists(window, '.calendar-scroll'), '首周未配置时进入课表设置');
    focusBranches.push({ branch: 'missing-first-monday', ...missingFocus });
    record('无未来安排与未设置学期首周显示不同引导，入口均可操作');
    service.store.workspace = workspace;
    service.store.saveWorkspace();
    service.changed();
    await button(window, '工作台首页');
    await waitFor(
      async () => (await focusSnapshot())?.label === '正在进行',
      '恢复当前课程设计样例',
    );
    for (const mode of ['light', 'dark'] as const) {
      await setTheme(window, mode);
      screenshots.push(await capture(window, 'home-' + mode, screenshotLayouts));
    }
    window.setSize(1024, 700);
    assert.equal(app.getName(), 'NEU-Dela');
    assert.equal(app.getPath('userData'), process.env.DOLA_DATA_DIR);
    assert(
      await window.webContents.executeJavaScript(`(() => {
        const name=document.querySelector('.sidebar .brand strong');
        const sidebar=document.querySelector('.sidebar');
        if(!name || !sidebar)return false;
        const bounds=name.getBoundingClientRect(), outer=sidebar.getBoundingClientRect();
        return name.textContent==='NEU-Dela' && name.scrollWidth<=name.clientWidth && bounds.right<=outer.right &&
          document.title==='NEU-Dela · 校园工作台' && !document.body.innerText.includes('Dola');
      })()`),
      '小窗口完整显示 NEU-Dela，页面标题和文案同步且继续使用指定数据目录',
    );
    record('NEU-Dela 名称在小窗口完整显示，窗口标题同步，隔离数据目录保持');
    assert(
      await window.webContents.executeJavaScript(`(() => {
      const page=document.querySelector('.dashboard-page');
      const bottom=document.querySelector('.sidebar-bottom').getBoundingClientRect();
      const history=document.querySelector('.history-row').getBoundingClientRect();
      const focus=document.querySelector('.dashboard-focus').getBoundingClientRect();
      return page.scrollWidth <= page.clientWidth && bottom.bottom <= innerHeight && history.height > 0 && history.top >= 0 && history.bottom <= innerHeight && focus.top >= 0 && focus.bottom <= innerHeight;
    })()`),
      '小窗口焦点、设置和历史同时可见且无横向溢出',
    );
    screenshots.push(await capture(window, 'home-compact', screenshotLayouts));
    await button(window, '设置');
    await waitFor(() => exists(window, '.settings-page'), '小窗口设置可打开');
    await button(window, chat.title);
    await waitFor(() => exists(window, '.message-assistant'), '小窗口历史对话可打开');
    record('1024×700 首页无横向溢出，下一步、历史与设置入口可见可用');
    window.setSize(1360, 900);
    await button(window, '工作台首页');
    await click(window, `[data-agenda-date="${tomorrow}"]`);
    await waitFor(() => exists(window, `[data-agenda-selected="${tomorrow}"]`), '切换明日日程');
    await click(window, `[data-agenda-course="${secondCourseId}"]`);
    await waitFor(() => exists(window, '.course-detail'), '日程打开课程');
    assert(
      (
        await window.webContents.executeJavaScript(`${select('.course-detail')}.textContent`)
      ).includes(tomorrow),
    );
    await closeModal(window);
    record('七天日程切换后打开正确日期的课程详情');
    for (const mode of ['light', 'dark'] as const) {
      await setTheme(window, mode);
      screenshots.push(await capture(window, 'timetable-' + mode, screenshotLayouts));
    }
    await button(window, '工作台首页');
    await button(window, '新便利贴');
    await fill(window, 'input[name=todoTitle]', '设计验证中新建的便利贴');
    await fill(window, 'textarea[name=todoDetail]', '完成后留在原位，可以再次点击恢复。');
    screenshots.push(await capture(window, 'todo-modal', screenshotLayouts));
    await button(window, '保存便利贴');
    await waitFor(
      () => service.store.workspace.todos.some((todo) => todo.title === '设计验证中新建的便利贴'),
      '新待办保存',
    );
    const newTodo = service.store.workspace.todos.find(
      (todo) => todo.title === '设计验证中新建的便利贴',
    )!;
    await click(window, `[data-todo-id="${newTodo.id}"] .dashboard-todo-check:not(:disabled)`);
    await waitFor(
      () => service.store.workspace.todos.find((todo) => todo.id === newTodo.id)?.done,
      '待办完成',
    );
    await waitFor(
      () =>
        exists(
          window,
          `[data-todo-id="${newTodo.id}"].completed .dashboard-todo-check:not(:disabled)`,
        ),
      '完成卡片仍可操作',
    );
    await click(window, `[data-todo-id="${newTodo.id}"] .dashboard-todo-check:not(:disabled)`);
    await waitFor(
      () => service.store.workspace.todos.find((todo) => todo.id === newTodo.id)?.done === false,
      '撤销完成',
    );
    record('新建便利贴、完成原位反馈与恢复完成状态可用');
    await click(window, `button[aria-label="打开笔记 ${workspace.notes[0].title}"]`);
    await waitFor(() => exists(window, 'textarea[name=noteBody]'), '最近笔记打开编辑器');
    await fill(window, 'textarea[name=noteBody]', workspace.notes[0].body + '\n\n设计验证新增记录');
    await button(window, '工作台首页');
    await waitFor(
      () =>
        service.store.workspace.notes
          .find((note) => note.id === noteId)
          ?.body.includes('设计验证新增记录'),
      '离开笔记保存',
    );
    record('首页打开最近笔记并在离开时保存新内容');
    await click(window, 'button[aria-label="搜索工作台"]');
    await fill(window, '.workspace-search-input input', '设计验证新增记录');
    await click(window, `[data-search-kind="note"][data-search-id="${noteId}"]`);
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `${select('textarea[name=noteBody]')}?.value.includes('设计验证新增记录')`,
        ),
      '全局搜索回到匹配笔记',
    );
    record('全局搜索命中新保存的笔记正文并打开原记录');
    for (const mode of ['light', 'dark'] as const) {
      await setTheme(window, mode);
      screenshots.push(await capture(window, 'notes-' + mode, screenshotLayouts));
    }
    await button(window, '开启新对话');
    await waitFor(() => exists(window, '.starter-grid button'), '聊天空白页建议');
    const chatsBefore = JSON.stringify(service.store.chats);
    await click(window, '.starter-grid button');
    assert(
      (await window.webContents.executeJavaScript(`${select('.composer textarea')}.value`)).length >
        0,
      '建议填入草稿',
    );
    assert.equal(JSON.stringify(service.store.chats), chatsBefore, '建议不创建或发送模型对话');
    record('空白聊天建议只填写草稿，不发起模型请求');
    for (const mode of ['light', 'dark'] as const) {
      await setTheme(window, mode);
      screenshots.push(await capture(window, 'chat-' + mode, screenshotLayouts));
    }
    await button(window, chat.title);
    await waitFor(() => exists(window, '.message-assistant'), '品牌头像样例');
    const brand = await window.webContents.executeJavaScript(`(() => {
      const images=Array.from(document.querySelectorAll('.brand-mark img'));
      return images.map(image=>({src:image.currentSrc,loaded:image.complete && image.naturalWidth>0}));
    })()`);
    assert(
      brand.length >= 2 && brand.every((image: { loaded: boolean }) => image.loaded),
      '侧栏与助手品牌图片都成功加载',
    );
    assert.equal(
      new Set(brand.map((image: { src: string }) => image.src)).size,
      1,
      '品牌图片统一来源',
    );
    record('侧栏与助手头像共用已成功加载的品牌图片');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await button(window, '工作台首页');
    await button(window, '新便利贴');
    reducedMotion = await window.webContents.executeJavaScript(`(() => ({
      matched:matchMedia('(prefers-reduced-motion: reduce)').matches,
      elements:['.dashboard-focus','.dashboard-stat','.work-modal'].map(selector=>{
        const style=getComputedStyle(document.querySelector(selector));
        return {selector,animationName:style.animationName,transitionDuration:style.transitionDuration};
      })
    }))()`);
    const motion = reducedMotion as {
      matched: boolean;
      elements: { selector: string; animationName: string; transitionDuration: string }[];
    };
    assert(motion.matched);
    for (const item of motion.elements) {
      assert(
        item.animationName.split(',').every((name) => name.trim() === 'none'),
        item.selector + ' 在减少动态效果时关闭动画',
      );
      assert(
        item.transitionDuration.split(',').every((value) => parseFloat(value) <= 0.01),
        item.selector + ' 在减少动态效果时关闭过渡',
      );
    }
    await closeModal(window);
    record('系统减少动态效果偏好关闭焦点、统计和弹窗的动画与过渡');
    assert.equal(networkRequests.length, 0, '设计流程没有外部网络请求');
    assert.equal(service.store.providers.length, 0);
    assert.equal(service.store.workspace.mailAccounts.length, 0);
    record('所有设计交互只使用人工本机数据，未发起模型或邮件网络请求');
  } catch (error) {
    writeFileSync(
      join(output, 'design-error.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    writeFileSync(
      join(output, 'design-error.txt'),
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    writeFileSync(
      join(output, 'report.json'),
      JSON.stringify(
        {
          passed: false,
          checks,
          screenshots,
          fixtureNow,
          rendererNow,
          screenshotLayouts,
          focusBranches,
          reducedMotion,
          networkRequests,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (window.webContents.debugger.isAttached()) {
      if (clockScript)
        await window.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: clockScript,
        });
      window.webContents.debugger.detach();
    }
    window.webContents.session.webRequest.onBeforeRequest(null);
    service.store.workspace = original.workspace;
    service.store.chats = original.chats;
    service.store.setTheme(original.theme);
    nativeTheme.themeSource = original.theme;
    service.store.saveWorkspace();
    service.store.saveChats();
  }
  assert.deepEqual(service.store.workspace, original.workspace);
  assert.deepEqual(service.store.chats, original.chats);
  assert.equal(service.store.theme, original.theme);
  record('验证结束后恢复隔离目录中的原始工作台、历史和外观状态');
  writeFileSync(
    join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        fixtureNow,
        rendererNow,
        screenshotLayouts,
        focusBranches,
        fixtureDescription:
          '人工课程、待办、笔记与历史对话；renderer 固定为当天北京时间 09:05 以复现当前课程状态',
        runtimeDirectory: service.store.dataDirectory,
        restoredOriginalState: true,
        checks,
        screenshots,
        reducedMotion,
        externalNetworkRequests: networkRequests.length,
        realApiRequests: 0,
      },
      null,
      2,
    ),
  );
}
