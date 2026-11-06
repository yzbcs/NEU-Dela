import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve, basename, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { app, BrowserWindow, dialog, session, webContents, nativeTheme } from 'electron';
import type { ChatService } from './chat';
import { graduateFixtureHtml } from '../../scripts/graduate-fixture';
import { addDays, chinaDate, dateNumber, periodTimes, type Todo } from '../shared/workspace';

const output = resolve('assets/output/ai-validation');
async function waitFor(check: () => boolean | Promise<boolean>, label: string) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('等待失败：' + label);
}
async function ready(window: BrowserWindow) {
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(window.dola?.workspace && document.querySelector(".work-page"))',
      ),
    '桌面 preload 与 React 挂载',
  );
}
async function screenshot(window: BrowserWindow, name: string) {
  await new Promise((r) => setTimeout(r, 250));
  writeFileSync(join(output, name + '.png'), (await window.webContents.capturePage()).toPNG());
}
async function theme(window: BrowserWindow, value: 'light' | 'dark' | 'system') {
  console.log('theme smoke: choose ' + value);
  const label = { light: '浅色模式', dark: '深色模式', system: '跟随系统' }[value];
  const selector = '.theme-switcher button[aria-label="' + label + '"]';
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector(' + JSON.stringify(selector + ':not([disabled])') + '))',
      ),
    '外观控件加载',
  );
  await window.webContents.executeJavaScript(
    'document.querySelector(' + JSON.stringify(selector) + ').click()',
  );
  await waitFor(() => nativeTheme.themeSource === value, '原生主题切换');
  const expected = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  await waitFor(
    async () =>
      (await window.webContents.executeJavaScript('document.documentElement.dataset.theme')) ===
      expected,
    '页面主题同步',
  );
}
async function darkSurface(window: BrowserWindow, selector: string) {
  const color = await window.webContents.executeJavaScript(
    'getComputedStyle(document.querySelector(' + JSON.stringify(selector) + ')).backgroundColor',
  );
  const channels = color
    .match(/^rgb\((\d+), (\d+), (\d+)\)$/)
    ?.slice(1)
    .map(Number);
  assert(channels && Math.max(...channels) < 100, selector + ' 应使用深色背景，实际为 ' + color);
}
async function runThemeSmoke(service: ChatService, window: BrowserWindow) {
  for (const [page, selector, name] of [
    ['今日便利贴', '.home-overview', 'theme-dark-home'],
    ['我的课表', '.calendar-scroll', 'theme-dark-timetable'],
    ['邮箱', '.mail-main', 'theme-dark-mail'],
    ['资料与笔记', '.note-editor', 'theme-dark-library'],
  ]) {
    console.log('theme smoke: ' + page);
    await clickButton(window, page);
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(' + JSON.stringify(selector) + '))',
        ),
      page + ' 挂载',
    );
    await darkSurface(window, '.work-page');
    await darkSurface(window, selector);
    await screenshot(window, name);
  }
  await clickButton(window, '今日便利贴');
  await clickButton(window, '新便利贴');
  await darkSurface(window, '.work-modal');
  await darkSurface(window, '.work-form input');
  await screenshot(window, 'theme-dark-modal');
  await window.webContents.executeJavaScript(
    'document.querySelector("button[aria-label=关闭弹窗]").click()',
  );
  await theme(window, 'system');
  for (const mode of ['light', 'dark'] as const) {
    nativeTheme.themeSource = mode;
    await waitFor(
      async () =>
        (await window.webContents.executeJavaScript('document.documentElement.dataset.theme')) ===
        mode,
      '系统主题信号变化',
    );
    assert.equal(service.store.theme, 'system');
  }
  await theme(window, 'light');
  await screenshot(window, 'theme-light-home');
  await clickButton(window, '我的课表');
  await screenshot(window, 'theme-light-timetable');
  window.setSize(1024, 700);
  assert.equal(
    await window.webContents.executeJavaScript(
      '(() => {const r=document.querySelector(".theme-switcher").getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0;})()',
    ),
    true,
    '小窗口也能看到主题切换',
  );
  window.setSize(1360, 900);
  console.log('theme smoke: composer draft');
  await clickButton(window, 'AI 助手');
  await fillFields(window, { '.composer textarea': '主题切换时保留的草稿' });
  await theme(window, 'dark');
  assert.equal(
    await window.webContents.executeJavaScript(
      'document.querySelector(".composer textarea").value',
    ),
    '主题切换时保留的草稿',
  );
  await darkSurface(window, '.composer');
  await fillFields(window, { '.composer textarea': '' });
}
async function runCourseColorSmoke(service: ChatService, window: BrowserWindow) {
  const original = structuredClone(service.store.workspace.timetable);
  const names = [
    '高等数学',
    '大学物理',
    '程序设计',
    '学术英语',
    '线性代数',
    '数据结构',
    '概率统计',
    '计算机网络',
    '优化方法',
    '跨文化交际',
  ];
  const today = chinaDate();
  const courses = names.map((name, i) => ({
    id: 'color-fixture-' + i,
    name,
    day: (i % 5) + 1,
    start: i < 5 ? 1 : 3,
    end: i < 5 ? 2 : 4,
    weeks: i === 0 ? '2-16' : '1-16',
    location: '示例教室',
    teacher: '',
    detail: '',
  }));
  courses.push(
    { ...courses[0], id: 'color-repeat-0', day: 6, weeks: '1-16' },
    { ...courses[1], id: 'color-repeat-1', day: 7 },
  );
  const sample = {
    ...original,
    term: '课程配色 · 人工测试课表',
    firstMonday: addDays(today, -((new Date(dateNumber(today)).getUTCDay() + 6) % 7)),
    courses,
  };
  const readCards = () =>
    window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.calendar-course')).map(card => {
      const style = getComputedStyle(card);
      return { name: card.querySelector('strong').textContent,
        hue: style.getPropertyValue('--course-hue'),
        background: style.backgroundColor, text: style.color };
    })
  `) as Promise<{ name: string; hue: string; background: string; text: string }[]>;
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .map(Number)
      .map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  try {
    await window.webContents.executeJavaScript(
      'window.dola.workspace.saveTimetable(' + JSON.stringify(sample) + ')',
    );
    await clickButton(window, '今日便利贴');
    await clickButton(window, '我的课表');
    await waitFor(async () => (await readCards()).length === 11, '多课程配色样例');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
    await theme(window, 'dark');
    const firstWeek = await readCards();
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=下一周]").click()',
    );
    await waitFor(async () => (await readCards()).length === 12, '下一周的重复课程');
    const secondWeek = await readCards();
    for (const card of firstWeek) {
      assert.equal(
        secondWeek.find((other) => other.name === card.name)?.background,
        card.background,
        card.name + ' 切周后应保持颜色',
      );
    }
    const result: Record<string, unknown> = {};
    for (const mode of ['dark', 'light'] as const) {
      await theme(window, mode);
      const cards = await readCards();
      const colors = new Map<string, string>();
      let minContrast = Infinity;
      for (const card of cards) {
        if (colors.has(card.name))
          assert.equal(colors.get(card.name), card.background, '同名课程跨天应保持颜色');
        colors.set(card.name, card.background);
        assert.equal(
          firstWeek.find((other) => other.name === card.name)?.hue,
          card.hue,
          '切换深浅模式应保留课程色系',
        );
        const a = luminance(card.background),
          b = luminance(card.text);
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert(contrast >= 4.5, mode + ' ' + card.name + ' 文字对比度不足：' + contrast);
        minContrast = Math.min(minContrast, contrast);
      }
      assert.equal(new Set(colors.values()).size, names.length, '不同课程应使用不同颜色');
      result[mode] = { cards, distinctCourses: colors.size, minContrast };
      await screenshot(window, 'course-colors-' + mode);
    }
    writeFileSync(join(output, 'course-colors.json'), JSON.stringify(result, null, 2));
  } finally {
    await window.webContents.executeJavaScript(
      'window.dola.workspace.saveTimetable(' + JSON.stringify(original) + ')',
    );
    await theme(window, 'dark');
  }
}
async function runDashboardSmoke(service: ChatService, window: BrowserWindow) {
  console.log('dashboard smoke: overview and actions');
  const originalTable = structuredClone(service.store.workspace.timetable);
  const originalNote = service.store.workspace.notes[0];
  const today = chinaDate();
  const day = ((new Date(dateNumber(today)).getUTCDay() + 6) % 7) + 1;
  const noteId: string = await window.webContents.executeJavaScript(
    'window.dola.workspace.saveNote(' +
      JSON.stringify({
        title: '首页跳转验证笔记',
        category: '课程学习',
        body: '# 最近的想法\n\n从工作台直接继续记录。',
      }) +
      ')',
  );
  let todoId: string | undefined;
  try {
    const courses = ['今天的第一门课', '今天的第二门课', '其他日期课程'].map((name, i) => ({
      id: 'dashboard-course-' + i,
      name,
      day: i < 2 ? day : (day % 7) + 1,
      start: i * 2 + 1,
      end: i * 2 + 2,
      weeks: '1-16',
      location: '示例教室',
      teacher: '',
      detail: '',
    }));
    await window.webContents.executeJavaScript(
      'window.dola.workspace.saveTimetable(' +
        JSON.stringify({
          ...originalTable,
          term: '工作台概览 · 人工测试课表',
          courses,
          firstMonday: addDays(today, -(day - 1)),
        }) +
        ')',
    );
    await clickButton(window, '工作台首页');
    const values = () =>
      window.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll(".dashboard-stat > strong")).map(node => Number(node.textContent))',
      );
    await waitFor(async () => JSON.stringify(await values()) === '[1,2,2,1]', '首页汇总真实数据');
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelectorAll(".agenda-items [data-agenda-course]").length',
      ),
      2,
    );
    await clickButton(window, '新便利贴');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector("input[name=todoTitle]"))',
        ),
      '首页新建便利贴',
    );
    await fillFields(window, {
      'input[name=todoTitle]': '首页创建的待办',
      'textarea[name=todoDetail]': '在首页写下，再去便利贴中继续管理。',
    });
    await clickButton(window, '保存便利贴');
    await waitFor(() => service.store.workspace.todos.length === 2, '首页待办保存');
    todoId = service.store.workspace.todos.find((todo) => todo.title === '首页创建的待办')!.id;
    await waitFor(
      async () => JSON.stringify(await values()) === '[2,2,2,1]',
      '首页待办计数即时更新',
    );
    await darkSurface(window, '.dashboard-stat');
    await darkSurface(window, '.dashboard-card');
    await screenshot(window, 'dashboard-dark');
    await theme(window, 'light');
    await screenshot(window, 'dashboard-light');
    window.setSize(1024, 700);
    assert.equal(
      await window.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.dashboard-page');
      const bottom = document.querySelector('.sidebar-bottom').getBoundingClientRect();
      return page.scrollWidth <= page.clientWidth && bottom.bottom <= innerHeight;
    })()`),
      true,
      '小窗口首页无横向溢出，侧栏底部入口可见',
    );
    await screenshot(window, 'dashboard-compact');
    window.setSize(1360, 900);
    await theme(window, 'dark');
    console.log('dashboard smoke: complete todo');
    await window.webContents.executeJavaScript(
      'document.querySelector(' +
        JSON.stringify('button[aria-label="完成待办 首页创建的待办"]') +
        ').click()',
    );
    await waitFor(
      () => service.store.workspace.todos.find((todo) => todo.id === todoId)?.done === true,
      '首页完成待办',
    );
    await waitFor(async () => JSON.stringify(await values()) === '[1,2,2,1]', '完成状态汇总联动');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[data-todo-id="${todoId}"].completed .dashboard-todo-check:not(:disabled)'))`,
        ),
      '首页保留已完成待办',
    );
    await screenshot(window, 'dashboard-todo-completed');
    await clickTodo(window, todoId);
    await waitFor(
      async () => JSON.stringify(await values()) === '[2,2,2,1]',
      '首页撤销完成恢复计数',
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[data-todo-id="${todoId}"]:not(.completed) .dashboard-todo-check:not(:disabled)'))`,
        ),
      '首页恢复后的待办可操作',
    );
    await clickTodo(window, todoId);
    await waitFor(async () => JSON.stringify(await values()) === '[1,2,2,1]', '首页再次完成');
    await window.webContents.executeJavaScript(
      'document.querySelector(".dashboard-shortcuts button").click()',
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".composer textarea"))',
        ),
      '首页快捷进入 AI',
    );
    await clickButton(window, '工作台首页');
    await window.webContents.executeJavaScript(
      'document.querySelector("[data-dashboard-stat=mail]").click()',
    );
    await waitFor(
      () => window.webContents.executeJavaScript('Boolean(document.querySelector(".mail-layout"))'),
      '首页邮箱入口',
    );
    await clickButton(window, '工作台首页');
    console.log('dashboard smoke: open note');
    await window.webContents.executeJavaScript(
      'document.querySelector(' +
        JSON.stringify('button[aria-label="打开笔记 首页跳转验证笔记"]') +
        ').click()',
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.querySelector("input[name=noteTitle]")?.value === "首页跳转验证笔记"',
        ),
      '首页打开指定笔记',
    );
    await fillFields(window, { 'textarea[name=noteBody]': '# 首页继续记录\n\n这段修改应保留。' });
    await waitFor(
      () =>
        service.store.workspace.notes
          .find((note) => note.id === noteId)
          ?.body.includes('这段修改应保留。') === true,
      '跳转笔记可编辑保存',
    );
    await clickButton(window, '工作台首页');
    await window.webContents.executeJavaScript(
      'document.querySelector(' +
        JSON.stringify('button[aria-label="打开笔记 ' + originalNote.title + '"]') +
        ').click()',
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.querySelector("input[name=noteTitle]")?.value === ' +
            JSON.stringify(originalNote.title),
        ),
      '首页打开另一篇笔记',
    );
    assert(
      service.store.workspace.notes
        .find((note) => note.id === noteId)
        ?.body.includes('这段修改应保留。'),
    );
    await clickButton(window, '今日便利贴');
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=已完成]").click()',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        'Boolean(document.querySelector(".todos-page")) && document.querySelector(".sticky.completed")?.textContent.includes("首页创建的待办")',
      ),
      true,
      '便利贴独立入口及完成状态保留',
    );
  } finally {
    if (todoId)
      await window.webContents.executeJavaScript(
        'window.dola.workspace.removeTodo(' + JSON.stringify(todoId) + ')',
      );
    await window.webContents.executeJavaScript(
      'window.dola.workspace.removeNote(' + JSON.stringify(noteId) + ')',
    );
    await window.webContents.executeJavaScript(
      'window.dola.workspace.saveTimetable(' + JSON.stringify(originalTable) + ')',
    );
    await theme(window, 'dark');
  }
}
async function runLearningWorkflowSmoke(service: ChatService, window: BrowserWindow) {
  console.log('learning smoke: agenda, search and course notes');
  const original = structuredClone(service.store.workspace);
  const originalChats = structuredClone(service.store.chats);
  const fixtureChat = {
    id: randomUUID(),
    title: '学习流历史对话',
    providerId: null,
    model: '',
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  const expectedChats = JSON.stringify([...originalChats, fixtureChat]);
  const today = chinaDate();
  const todayDay = ((new Date(dateNumber(today)).getUTCDay() + 6) % 7) + 1;
  const selectedDate = addDays(today, 6);
  const courseDay = ((new Date(dateNumber(selectedDate)).getUTCDay() + 6) % 7) + 1;
  const course = {
    id: randomUUID(),
    name: '学习流验证课程',
    day: courseDay,
    start: 1,
    end: 2,
    weeks: '1-2',
    location: '学习楼 302',
    teacher: '演示教师',
    detail: '课程搜索独有词',
  };
  const note = {
    id: randomUUID(),
    title: '课程里的已存笔记',
    category: course.name,
    body: '正文命中词：拉格朗日检索验证',
    updatedAt: new Date().toISOString(),
  };
  const otherNote = {
    ...note,
    id: randomUUID(),
    title: '其他课程笔记',
    category: '另一门课程',
    body: '其他内容',
  };
  const todo: Todo = {
    id: randomUUID(),
    title: '学习流截止待办',
    detail: '待办搜索独有词',
    color: 'blue',
    dueAt: selectedDate + 'T16:00:00+08:00',
    reminder: false,
    repeat: 'none',
    done: false,
    notifiedAt: '',
    createdAt: new Date().toISOString(),
  };
  const select = (selector: string) => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const present = (selector: string) =>
    window.webContents.executeJavaScript('Boolean(' + select(selector) + ')');
  const closeModal = async () => {
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=关闭弹窗]")?.click()',
    );
    await waitFor(
      () => window.webContents.executeJavaScript('!document.querySelector("[role=dialog]")'),
      '关闭学习流程弹窗',
    );
  };
  const search = async (query: string, kind: string, id: string) => {
    window.webContents.focus();
    const modifiers: ('meta' | 'control')[] =
      process.platform === 'darwin' ? ['meta'] : ['control'];
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers });
    await waitFor(() => present('.workspace-search-input input'), '快捷键打开全局搜索');
    await fillFields(window, { '.workspace-search-input input': query });
    const selector = `[data-search-kind="${kind}"][data-search-id="${id}"]`;
    await waitFor(() => present(selector), '找到 ' + kind + ' 搜索结果');
    return selector;
  };
  const openResult = async (query: string, kind: string, id: string) => {
    const selector = await search(query, kind, id);
    await window.webContents.executeJavaScript(select(selector) + '.click()');
    await waitFor(
      () => window.webContents.executeJavaScript('!document.querySelector(".workspace-search")'),
      '打开搜索结果',
    );
  };
  try {
    await clickButton(window, '工作台首页');
    service.store.chats = [...originalChats, fixtureChat];
    service.store.saveChats();
    service.store.workspace = {
      ...structuredClone(original),
      timetable: {
        ...original.timetable,
        term: '学习流程 · 人工课表',
        periods: periodTimes.map(([start, end]): [string, string] => [start, end]),
        firstMonday: addDays(today, -(todayDay - 1)),
        courses: [
          course,
          { ...course, id: randomUUID(), name: '重叠时间验证课程', start: 2, end: 3 },
        ],
      },
      todos: [
        todo,
        {
          ...todo,
          id: randomUUID(),
          title: '此前逾期验证',
          dueAt: addDays(today, -1) + 'T16:00:00+08:00',
        },
        { ...todo, id: randomUUID(), title: '无时间验证', dueAt: '' },
      ],
      notes: [note, otherNote],
      notebooks: [course.name, otherNote.category],
      resources: [
        {
          id: randomUUID(),
          title: '本课程参考资料',
          kind: 'link',
          category: course.name,
          path: 'https://example.test/course',
          addedAt: today,
        },
        {
          id: randomUUID(),
          title: '其他课程参考资料',
          kind: 'link',
          category: otherNote.category,
          path: 'https://example.test/other',
          addedAt: today,
        },
      ],
    };
    service.store.saveWorkspace();
    service.changed();
    await waitFor(() => present('[data-agenda-date="' + selectedDate + '"]'), '七天安排挂载');
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll("[data-agenda-date]")).map(button=>button.dataset.agendaDate)',
      ),
      Array.from({ length: 7 }, (_, index) => addDays(today, index)),
      '七个日期从北京时间今天开始连续排列',
    );
    await window.webContents.executeJavaScript(
      select('[data-agenda-date="' + selectedDate + '"]') + '.click()',
    );
    await waitFor(() => present('[data-agenda-selected="' + selectedDate + '"]'), '切换到第七天');
    assert(await present(`[data-agenda-date="${selectedDate}"][aria-pressed=true]`));
    assert(await present(`[data-agenda-course="${course.id}"]`));
    assert(await present(`[data-agenda-todo="${todo.id}"]`));
    assert(await present('.agenda-conflict'), '选中日显示实际重叠的课程');
    for (const title of ['此前逾期', '未设时间']) {
      assert(await present(`[data-agenda-backlog="${title}"]`), title + ' 单列');
    }
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelectorAll(".agenda-items [data-agenda-todo]").length',
      ),
      1,
    );
    for (const mode of ['dark', 'light'] as const) {
      await theme(window, mode);
      if (mode === 'dark') await darkSurface(window, '.dashboard-agenda');
      await screenshot(window, 'learning-agenda-' + mode);
    }
    window.setSize(1024, 700);
    assert(
      await window.webContents.executeJavaScript(`(() => {
      const page=document.querySelector('.dashboard-page');
      const days=document.querySelector('.agenda-days').getBoundingClientRect();
      return page.scrollWidth <= page.clientWidth && days.right <= innerWidth;
    })()`),
      '小窗口七天安排不横向溢出',
    );
    await screenshot(window, 'learning-agenda-compact');
    window.setSize(1360, 900);
    await theme(window, 'dark');
    await window.webContents.executeJavaScript(
      select(`[data-agenda-todo="${todo.id}"]`) + '.click()',
    );
    await waitFor(() => present('input[name=todoTitle]'), '日程打开待办编辑');
    assert.equal(
      await window.webContents.executeJavaScript(select('input[name=todoTitle]') + '.value'),
      todo.title,
    );
    await closeModal();
    await window.webContents.executeJavaScript(
      select(`[data-agenda-course="${course.id}"]`) + '.click()',
    );
    await waitFor(() => present('.course-learning'), '日程打开准确课程');
    assert(
      (
        await window.webContents.executeJavaScript(select('.course-detail') + '.textContent')
      ).includes(selectedDate),
      '课程详情保留日程所选日期',
    );
    assert(await present('.course-conflicts'), '课表显示本周冲突提示');
    await clickButton(window, '新建本次课程笔记');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          select('input[name=noteTitle]') +
            '?.value === ' +
            JSON.stringify(course.name + ' · ' + selectedDate),
        ),
      '课程笔记预填标题与日期',
    );
    const created = service.store.workspace.notes.find(
      (item) => item.id !== note.id && item.id !== otherNote.id,
    )!;
    assert.equal(created.category, course.name);
    assert(created.body.includes(selectedDate));
    assert(created.body.includes(periodTimes[0][0] + '—' + periodTimes[1][1]));
    assert(created.body.includes(course.location) && created.body.includes(course.teacher));

    // 搜索必须先保存刚修改的正文；这里不等待 700ms 自动保存。
    await fillFields(window, {
      'textarea[name=noteBody]': created.body + '\n\n刚修改即搜索验证词',
    });
    const editedSelector = await search('刚修改即搜索验证词', 'note', created.id);
    assert(
      service.store.workspace.notes
        .find((item) => item.id === created.id)
        ?.body.includes('刚修改即搜索验证词'),
    );
    await screenshot(window, 'learning-search-dark');
    await closeModal();
    await theme(window, 'light');
    await search('刚修改即搜索验证词', 'note', created.id);
    await screenshot(window, 'learning-search-light');
    window.setSize(1024, 700);
    assert(
      await window.webContents.executeJavaScript(`(() => {
      const panel=document.querySelector('.work-modal').getBoundingClientRect();
      const input=document.querySelector('.workspace-search-input input').getBoundingClientRect();
      return panel.left >= 0 && panel.right <= innerWidth && input.width > 200;
    })()`),
      '小窗口搜索可见且输入框可用',
    );
    await screenshot(window, 'learning-search-compact');
    window.setSize(1360, 900);
    await window.webContents.executeJavaScript(select(editedSelector) + '.click()');
    await waitFor(
      () => window.webContents.executeJavaScript('!document.querySelector(".workspace-search")'),
      '搜索返回正在编辑的笔记',
    );
    await theme(window, 'dark');
    await openResult('拉格朗日检索验证', 'note', note.id);
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          select('input[name=noteTitle]') + '?.value === ' + JSON.stringify(note.title),
        ),
      '按正文打开已有笔记',
    );
    await window.webContents.executeJavaScript(
      select(`[data-note-id="${otherNote.id}"]`) + '.click()',
    );
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          select('input[name=noteTitle]') + '?.value === ' + JSON.stringify(otherNote.title),
        ),
      '切到另一篇笔记',
    );
    await openResult('拉格朗日检索验证', 'note', note.id);
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          select('input[name=noteTitle]') + '?.value === ' + JSON.stringify(note.title),
        ),
      '重复搜索同一笔记仍正确定位',
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      await openResult('待办搜索独有词', 'todo', todo.id);
      await waitFor(() => present('input[name=todoTitle]'), '搜索待办打开编辑弹窗');
      assert.equal(
        await window.webContents.executeJavaScript(select('input[name=todoTitle]') + '.value'),
        todo.title,
      );
      await closeModal();
      await openResult('课程搜索独有词', 'course', course.id);
      await waitFor(() => present('.course-learning'), '搜索课程打开详情');
      assert(
        (
          await window.webContents.executeJavaScript(select('.work-modal h2') + '.textContent')
        ).includes(course.name),
      );
      if (repeat === 0) await closeModal();
    }
    await clickButton(window, '课程笔记 2');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.querySelectorAll(".note-list-item").length === 2',
        ),
      '课程入口筛选同名笔记本',
    );
    assert(!(await present(`[data-note-id="${otherNote.id}"]`)), '其他课程笔记不混入');
    await openResult('课程搜索独有词', 'course', course.id);
    await waitFor(() => present('.course-learning'), '再次打开课程学习入口');
    await clickButton(window, '课程资料 1');
    await waitFor(() => present('.resource-grid'), '课程入口打开资料分类');
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll(".resource-card strong")).map(node=>node.textContent)',
      ),
      ['本课程参考资料'],
    );
    await clickButton(window, 'AI 助手');
    await waitFor(() => present('.composer textarea'), '聊天草稿输入框');
    const unsent = '搜索历史对话时保留这段未发送草稿';
    await fillFields(window, { '.composer textarea': unsent });
    await openResult(fixtureChat.title, 'chat', fixtureChat.id);
    await waitFor(() => present('.composer textarea'), '搜索打开历史对话');
    assert.equal(
      await window.webContents.executeJavaScript(select('.composer textarea') + '.value'),
      unsent,
      '搜索历史对话保留未发送草稿',
    );
    await clickButton(window, fixtureChat.title);
    assert.equal(
      await window.webContents.executeJavaScript(select('.composer textarea') + '.value'),
      unsent,
      '点击当前历史对话仍保留草稿',
    );
    await fillFields(window, { '.composer textarea': '' });
    assert.equal(
      JSON.stringify(service.store.chats),
      expectedChats,
      '学习工作流不创建或发送 AI 对话',
    );
  } finally {
    await closeModal();
    await window.webContents.executeJavaScript(
      select('button[aria-label="删除对话 ' + fixtureChat.title + '"]') + '?.click()',
    );
    await waitFor(
      () => !service.store.chats.some((chat) => chat.id === fixtureChat.id),
      '移除人工历史对话',
    );
    await clickButton(window, '工作台首页');
    await waitFor(() => present('.dashboard-page'), '清理学习流程页面');
    service.store.workspace = original;
    service.store.chats = originalChats;
    service.store.saveWorkspace();
    service.store.saveChats();
    service.changed();
    window.setSize(1360, 900);
    await theme(window, 'dark');
  }
  assert.deepEqual(service.store.workspace, original, '学习工作流隔离数据完整恢复');
  assert.deepEqual(service.store.chats, originalChats, '学习工作流历史对话恢复');
}
async function runAssistantSmoke(service: ChatService, window: BrowserWindow) {
  console.log('assistant smoke: real workspace tools');
  await clickButton(window, '资料与笔记');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("textarea[name=noteBody]"))',
      ),
    '打开待编辑笔记',
  );
  const freshBody =
    service.store.workspace.notes[0].body + '\n\n即时更新：这条备忘刚写好就切到了 AI 助手。';
  await fillFields(window, { 'textarea[name=noteBody]': freshBody });
  await clickButton(window, 'AI 助手');
  await waitFor(
    () => service.store.workspace.notes[0].body === freshBody,
    '离开笔记立即保存最新内容',
  );
  const folder = service.store.workspace.resources.find((resource) => resource.kind === 'folder')!;
  writeFileSync(
    join(folder.path, 'ai-workbench-fixture.md'),
    '# AI 联动资料\n\n这是从关联文件夹实际读取的内容。',
  );
  const provider = service.store.providers.find((p) => p.protocol === 'openai-chat')!;
  const id: string = await window.webContents.executeJavaScript(
    'window.dola.createChat(' + JSON.stringify(provider.id) + ')',
  );
  await clickButton(window, '新对话');
  await fillAndSend(window, '[workbench] 工作台联动读取验证');
  await waitFor(
    () => service.store.chat(id).messages.at(-1)?.state === 'complete',
    '完整工作台工具轮次',
  );
  const reply = service.store.chat(id).messages.at(-1)!;
  assert.equal(reply.activity?.length, 12);
  assert(reply.activity!.every((step) => step.status === 'done'));
  assert(reply.text.includes('示例课程'));
  assert(reply.text.includes('从关联文件夹实际读取'));
  assert(reply.text.includes('Mail fixture body'));
  assert(reply.text.includes('这条备忘刚写好就切到了 AI 助手'));
  assert.equal(
    await window.webContents.executeJavaScript(
      'document.querySelectorAll(".message-user .user-avatar svg").length',
    ),
    1,
    '用户消息包含头像',
  );
  assert.equal(
    await window.webContents.executeJavaScript(
      'document.querySelectorAll(".message-sources button").length',
    ),
    reply.sources!.length,
  );
  await screenshot(window, 'chat-workbench-dark');
  await theme(window, 'light');
  await screenshot(window, 'chat-workbench-light');
  window.setSize(1024, 700);
  assert.equal(
    await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button[aria-label="工作台访问"]').getBoundingClientRect();
    const send = document.querySelector('.send-button').getBoundingClientRect();
    return button.right <= innerWidth && send.right <= innerWidth && button.bottom <= innerHeight;
  })()`),
    true,
    '小窗口工作台开关与发送按钮可见',
  );
  window.setSize(1360, 900);
  await theme(window, 'dark');
  await window.webContents.executeJavaScript(
    'document.querySelector(".read-activity").open=true;document.querySelector(".chat-scroll").scrollTop=0;',
  );
  await screenshot(window, 'chat-workbench-reads');
  const source = reply.sources!.find(
    (s) => s.kind === 'note' && s.id === service.store.workspace.notes[0].id,
  )!;
  await window.webContents.executeJavaScript(
    'Array.from(document.querySelectorAll(".message-sources button")).find(button => button.textContent.startsWith(' +
      JSON.stringify('[' + source.citation + ']') +
      ')).click()',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector("input[name=noteTitle]")?.value === "课程随记"',
      ),
    '参考来源打开对应笔记',
  );
  await clickButton(window, service.store.chat(id).title);
  await window.webContents.executeJavaScript(
    'document.querySelector("button[aria-label=工作台访问]").click()',
  );
  await fillAndSend(window, '关闭工作台访问后的普通聊天');
  await waitFor(
    () =>
      service.store.chat(id).messages.length === 4 &&
      service.store.chat(id).messages.at(-1)?.state === 'complete',
    '关闭读取后普通聊天',
  );
  assert.equal(service.store.chat(id).workspaceAccess, false);
  assert.equal(service.store.chat(id).messages.at(-1)?.activity, undefined);
  return { id, reads: reply.activity!.length, sources: reply.sources!.length };
}

async function runNotesSmoke(service: ChatService, window: BrowserWindow) {
  console.log('notes smoke: notebooks, pinning and checklist');
  await clickButton(window, '资料与笔记');
  const original = service.store.workspace.notes[0];
  await clickButton(window, '新建笔记本');
  await fillFields(window, { 'input[name=notebookName]': '课程与备忘' });
  await clickButton(window, '保存笔记本');
  await waitFor(() => service.store.workspace.notebooks.includes('课程与备忘'), '保存空笔记本');
  await waitFor(
    () => window.webContents.executeJavaScript('!document.querySelector("[role=dialog]")'),
    '笔记本对话框关闭',
  );
  await clickButton(window, '新笔记');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("textarea[name=noteBody]:not(:disabled)"))',
      ),
    '新笔记编辑器',
  );
  const body =
    '# 阅读安排\n\n- [ ] 整理材料\n- [x] 已完成摘要\n\n## 代码示例\n\n```text\n- [ ] 这只是代码中的示例\n```';
  await fillFields(window, {
    'input[name=noteTitle]': '备忘录交互验证',
    'textarea[name=noteBody]': body,
  });
  await window.webContents.executeJavaScript(
    'document.querySelector("button[aria-label=置顶笔记]").click()',
  );
  await clickButton(window, '阅读模式');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelectorAll(".memo-task-check").length === 2',
      ),
    '渲染可勾选清单而不处理代码示例',
  );
  const noteId = service.store.workspace.notes.find((note) => note.category === '课程与备忘')!.id;
  await clickVisibleButton(window, '.memo-task-check[aria-pressed=false]');
  await waitFor(
    () =>
      service.store.workspace.notes
        .find((note) => note.id === noteId)
        ?.body.includes('- [x] 整理材料') === true,
    '清单完成保存',
  );
  await clickVisibleButton(window, '.memo-task-check');
  await waitFor(
    () =>
      service.store.workspace.notes
        .find((note) => note.id === noteId)
        ?.body.includes('- [ ] 整理材料') === true,
    '清单恢复保存',
  );
  assert(service.store.workspace.notes.find((note) => note.id === noteId)?.pinned);
  assert(
    service.store.workspace.notes
      .find((note) => note.id === noteId)
      ?.body.includes('- [ ] 这只是代码中的示例'),
  );
  await screenshot(window, 'notes-dark');
  await theme(window, 'light');
  await screenshot(window, 'notes-light');
  window.setSize(1024, 700);
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'getComputedStyle(document.querySelector(".notebook-mobile")).display !== "none"',
      ),
    '小窗口笔记本切换入口',
  );
  assert(
    await window.webContents.executeJavaScript(`(() => {
    const editor=document.querySelector('.note-editor').getBoundingClientRect();
    const page=document.querySelector('.library-page');
    return editor.width >= 350 && editor.right <= innerWidth && page.scrollWidth <= page.clientWidth;
  })()`),
    '小窗口编辑器可用且无横向溢出',
  );
  await screenshot(window, 'notes-compact');
  window.setSize(1360, 900);
  await theme(window, 'dark');
  await fillFields(window, { '.work-search input': '整理材料' });
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelectorAll(".note-list-item").length === 1',
      ),
    '按正文搜索笔记',
  );
  await fillFields(window, { '.work-search input': '不存在的搜索内容' });
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector(".notes-empty-list")) && !document.querySelector("input[name=noteTitle]")',
      ),
    '搜索无结果不展示无关正文',
  );
  await fillFields(window, { '.work-search input': '' });
  await window.webContents.executeJavaScript(
    'document.querySelector("button[aria-label=重命名笔记本]").click()',
  );
  await fillFields(window, { 'input[name=notebookName]': '本学期备忘' });
  await clickButton(window, '保存笔记本');
  await waitFor(
    () =>
      service.store.workspace.notes.find((note) => note.id === noteId)?.category === '本学期备忘',
    '重命名保留笔记与正文',
  );
  await waitFor(
    () => window.webContents.executeJavaScript('!document.querySelector("[role=dialog]")'),
    '重命名对话框关闭',
  );
  const chatCount = service.store.chats.length;
  await clickButton(window, '问问 AI');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector("textarea[name=prompt]")?.value.includes("备忘录交互验证")',
      ),
    '问问 AI 准备提问草稿',
  );
  assert.equal(service.store.chats.length, chatCount, '问问 AI 不自动发送模型请求');
  await fillFields(window, { 'textarea[name=prompt]': '' });
  await clickButton(window, '资料与笔记');
  await window.webContents.executeJavaScript(
    'document.querySelector(' + JSON.stringify(`[data-note-id="${original.id}"]`) + ').click()',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector("input[name=noteTitle]")?.value === ' +
          JSON.stringify(original.title),
      ),
    '返回原笔记',
  );
  await window.webContents.executeJavaScript(
    'window.dola.workspace.removeNote(' + JSON.stringify(noteId) + ')',
  );
  await window.webContents.executeJavaScript('window.dola.workspace.removeNotebook("本学期备忘")');
  await waitFor(() => service.store.workspace.notes.length === 1, '清理人工备忘录');
}
async function runGraduateSmoke(service: ChatService, main: BrowserWindow) {
  const schoolSession = session.fromPartition('persist:neu-graduate');
  schoolSession.protocol.handle('https', (request) => {
    const url = new URL(request.url);
    let html = '';
    if (url.hostname === 'pass.neu.edu.cn')
      html =
        '<meta charset="utf-8"><title>人工登录页</title><input type="password" value="fixture-password"><a href="https://yjs.neu.edu.cn/fixture-home">进入个人课表演示</a>';
    else if (url.pathname === '/fixture-home')
      html =
        '<meta charset="utf-8"><title>人工研究生门户</title><h2>个人课表</h2><iframe style="width:100%;height:650px" src="/fixture-courses?ticket=fixture-access-token"></iframe><iframe style="display:none" src="/fixture-hidden"></iframe>';
    else if (url.pathname === '/fixture-courses') html = graduateFixtureHtml();
    else if (url.pathname === '/fixture-hidden')
      html = graduateFixtureHtml().replaceAll('课程甲', '隐藏旧课程');
    else
      return new Response(null, {
        status: 302,
        headers: { location: 'https://pass.neu.edu.cn/fixture-login' },
      });
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  const open = async () => {
    await clickButton(main, '网页导入');
    await waitFor(
      () =>
        BrowserWindow.getAllWindows().some(
          (win) => win !== main && win.getTitle() === '研究生课表导入 · NEU-Dela',
        ),
      '学校导入窗口',
    );
    const browser = BrowserWindow.getAllWindows().find(
      (win) => win !== main && win.getTitle() === '研究生课表导入 · NEU-Dela',
    )!;
    await waitFor(
      () =>
        browser.webContents.executeJavaScript(
          'Boolean(window.graduateImport && document.getElementById("read"))',
        ),
      '导入工具栏 preload',
    );
    await waitFor(
      () =>
        webContents
          .getAllWebContents()
          .some((page) => page.getURL() === 'https://pass.neu.edu.cn/fixture-login'),
      '模拟统一认证页面',
    );
    const remote = webContents
      .getAllWebContents()
      .find((page) => page.getURL() === 'https://pass.neu.edu.cn/fixture-login')!;
    await darkSurface(browser, 'body');
    return { browser, remote };
  };
  try {
    let { browser, remote } = await open();
    assert.equal(
      await remote.executeJavaScript(
        'typeof require === "undefined" && typeof window.dola === "undefined" && typeof window.graduateImport === "undefined"',
      ),
      true,
    );
    await clickButton(browser, '读取当前课表');
    await waitFor(
      () =>
        browser.webContents.executeJavaScript(
          'document.getElementById("status").textContent.includes("完成登录")',
        ),
      '未登录读取提示',
    );
    assert.equal(service.store.workspace.timetable.courses.length, 2);
    browser.close();
    await waitFor(
      () =>
        main.webContents.executeJavaScript(
          'document.body.textContent.includes("网页导入") && !document.body.textContent.includes("等待网页导入")',
        ),
      '关闭网页导入取消等待',
    );
    assert.equal(service.store.workspace.timetable.courses.length, 2);
    ({ browser, remote } = await open());
    await remote.executeJavaScript('document.querySelector("a").click()');
    await waitFor(
      () => remote.getURL() === 'https://yjs.neu.edu.cn/fixture-home',
      '人工登录后进入学校门户',
    );
    await waitFor(
      () =>
        remote.executeJavaScript(
          'Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("table"))',
        ),
      '内嵌课表完成加载',
    );
    const point = await browser.webContents.executeJavaScript(
      '(() => { const r = document.getElementById("read").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()',
    );
    browser.webContents.sendInputEvent({
      type: 'mouseDown',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    browser.webContents.sendInputEvent({
      type: 'mouseUp',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await waitFor(
      () =>
        main.webContents.executeJavaScript(
          'document.querySelectorAll(".course-editor tbody tr").length === 3',
        ),
      '网页课表预览',
    );
    assert.equal(service.store.workspace.timetable.courses.length, 2, '预览不能立即覆盖旧课表');
    assert.equal(
      await main.webContents.executeJavaScript('document.querySelector("input[name=term]").value'),
      '2026-2027学年第一学期',
    );
    await fillFields(main, { 'input[name=firstMonday]': '2026-11-02' });
    await screenshot(main, 'workspace-web-import');
    await clickButton(main, '确认保存课表');
    await waitFor(() => service.store.workspace.timetable.courses.length === 3, '网页课表确认保存');
    assert.equal(
      service.store.workspace.timetable.sourceUrl,
      'https://yjs.neu.edu.cn/fixture-courses',
    );
    const snapshot = readFileSync(
      join(service.store.dataDirectory, 'timetables', 'graduate-webpage.json'),
      'utf8',
    );
    assert.equal(snapshot.includes('fixture-password'), false);
    assert.equal(snapshot.includes('fixture-access-token'), false);
    assert.equal(snapshot.includes('隐藏旧课程'), false);
    await screenshot(main, 'workspace-web-timetable');
    await clickButton(main, '导出日历');
    await waitFor(
      () =>
        (readFileSync(join(output, 'NEU-课表.ics'), 'utf8').match(/BEGIN:VEVENT/g)?.length ?? 0) ===
        13,
      '网页课表周次正确导出',
    );
  } finally {
    schoolSession.protocol.unhandle('https');
  }
}
async function clickButton(window: BrowserWindow, text: string) {
  const find =
    'Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === ' +
    JSON.stringify(text) +
    ')';
  await waitFor(
    () => window.webContents.executeJavaScript('Boolean(' + find + ')'),
    '按钮 ' + text,
  );
  await window.webContents.executeJavaScript('(' + find + ').click()');
}
async function clickTodo(window: BrowserWindow, id: string, times = 1) {
  return clickVisibleButton(
    window,
    `[data-todo-id="${id}"] .todo-check, [data-todo-id="${id}"] .dashboard-todo-check`,
    times,
  );
}
async function clickVisibleButton(window: BrowserWindow, selector: string, times = 1) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) throw new Error('按钮不可点击');
    button.scrollIntoView({block:'nearest'});
    const r = button.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    if (document.elementFromPoint(x, y)?.closest('button') !== button) throw new Error('按钮被遮挡');
    return {x, y};
  })()`);
  for (let i = 0; i < times; i++) {
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  }
}
async function chooseOption(window: BrowserWindow, name: string, value: string) {
  await window.webContents.executeJavaScript(
    'document.querySelector(' + JSON.stringify('[data-select="' + name + '"]') + ').click()',
  );
  const find =
    'Array.from(document.querySelectorAll(".select-menu [role=option]")).find(option => option.dataset.value === ' +
    JSON.stringify(value) +
    ')';
  await waitFor(
    () => window.webContents.executeJavaScript('Boolean(' + find + ')'),
    '可选项 ' + name,
  );
  await window.webContents.executeJavaScript(find + '.click()');
  await waitFor(
    () => window.webContents.executeJavaScript('!document.querySelector(".select-menu")'),
    '关闭选择列表',
  );
}
async function fillAndSend(window: BrowserWindow, text: string) {
  await window.webContents.executeJavaScript(
    '(() => {const input = document.querySelector("textarea[name=prompt]");' +
      'Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,' +
      JSON.stringify(text) +
      ');input.dispatchEvent(new Event("input",{bubbles:true}));})()',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("button[aria-label=发送消息]:not(:disabled)"))',
      ),
    '输入框更新',
  );
  await window.webContents.executeJavaScript(
    'document.querySelector("button[aria-label=发送消息]").click()',
  );
}

async function fillFields(window: BrowserWindow, fields: Record<string, string>) {
  for (const [selector, value] of Object.entries(fields))
    await window.webContents.executeJavaScript(
      '(()=>{const input=document.querySelector(' +
        JSON.stringify(selector) +
        ');if(!input)throw new Error("字段不存在");const prototype=input.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(input,' +
        JSON.stringify(value) +
        ');input.dispatchEvent(new Event("input",{bubbles:true}));})()',
    );
}

async function runWorkspaceSmoke(service: ChatService, window: BrowserWindow) {
  const originalOpen = dialog.showOpenDialog,
    originalSave = dialog.showSaveDialog;
  const pdf = process.env.DOLA_PDF_FIXTURE!;
  dialog.showOpenDialog = (async (_window: unknown, options: { properties?: string[] }) => ({
    canceled: false,
    filePaths: [options.properties?.includes('openDirectory') ? dirname(pdf) : pdf],
  })) as typeof dialog.showOpenDialog;
  dialog.showSaveDialog = (async (_window: unknown, options: { defaultPath?: string }) => ({
    canceled: false,
    filePath: join(output, basename(options.defaultPath ?? 'attachment.txt')),
  })) as typeof dialog.showSaveDialog;
  try {
    console.log('workspace smoke: todo');
    await clickButton(window, '今日便利贴');
    await clickButton(window, '新便利贴');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector("input[name=todoTitle]"))',
        ),
      '便利贴编辑器',
    );
    await fillFields(window, {
      'input[name=todoTitle]': '完成课程作业',
      'textarea[name=todoDetail]': '整理材料，完成今天的一小步。',
    });
    await clickButton(window, '保存便利贴');
    await waitFor(() => service.store.workspace.todos.length === 1, '便利贴保存');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".todo-check")) && !document.querySelector("[role=dialog]")',
        ),
      '便利贴显示在首页',
    );
    const todo = service.store.workspace.todos[0];
    const originalPosition = await window.webContents.executeJavaScript(`(() => {
      const r=document.querySelector('.sticky').getBoundingClientRect();return {x:r.x,y:r.y};
    })()`);
    await clickTodo(window, todo.id);
    await waitFor(() => service.store.workspace.todos[0].done, '勾选便利贴');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".sticky.completed .todo-check:not(:disabled)"))',
        ),
      '完成卡片保留且可撤销',
    );
    await screenshot(window, 'todo-completed-dark');
    await theme(window, 'light');
    await screenshot(window, 'todo-completed-light');
    await theme(window, 'dark');
    assert.deepEqual(
      await window.webContents.executeJavaScript(`(() => {
      const r=document.querySelector('.sticky').getBoundingClientRect();return {x:r.x,y:r.y};
    })()`),
      originalPosition,
      '完成卡片留在原位',
    );
    assert.equal(
      JSON.parse(readFileSync(join(service.store.dataDirectory, 'workspace.json'), 'utf8')).todos[0]
        .done,
      true,
      '视觉保留期间完成状态已经落盘',
    );
    await clickTodo(window, todo.id);
    await waitFor(() => !service.store.workspace.todos[0].done, '原位恢复便利贴');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".sticky:not(.completed) .todo-check:not(:disabled)"))',
        ),
      '恢复后的卡片可操作',
    );
    await clickTodo(window, todo.id);
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".todo-completion-bar button:not(:disabled)"))',
        ),
      '完成反馈栏',
    );
    await clickButton(window, '收起已完成');
    await waitFor(
      () => window.webContents.executeJavaScript('!document.querySelector(".sticky")'),
      '主动收起完成项',
    );
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=已完成]").click()',
    );
    await waitFor(
      () => window.webContents.executeJavaScript('Boolean(document.querySelector(".todo-check"))'),
      '显示已完成便利贴',
    );
    await window.webContents.executeJavaScript('document.querySelector(".todo-check").click()');
    await waitFor(() => !service.store.workspace.todos[0].done, '恢复待办');
    await clickButton(window, '待完成');
    const repeatDue = new Date(Math.floor((Date.now() + 3600000) / 60000) * 60000).toISOString();
    await window.webContents.executeJavaScript(
      'window.dola.workspace.saveTodo(' +
        JSON.stringify({
          title: '重复提醒交互验证',
          detail: '',
          color: 'green',
          dueAt: repeatDue,
          reminder: true,
          repeat: 'daily',
          done: false,
        }) +
        ')',
    );
    await waitFor(() => service.store.workspace.todos.length === 2, '创建重复事项');
    const repeating = { ...service.store.workspace.todos[0] };
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[data-todo-id="${repeating.id}"] .todo-check'))`,
        ),
      '重复事项显示',
    );
    await clickTodo(window, repeating.id, 2);
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[data-todo-id="${repeating.id}"].completed .todo-check:not(:disabled)'))`,
        ),
      '重复事项完成反馈',
    );
    assert.equal(
      service.store.workspace.todos[0].dueAt,
      new Date(Date.parse(repeatDue) + 86400000).toISOString(),
      '快速双击只完成一个周期',
    );
    assert.equal(service.store.workspace.todos[0].done, false);
    assert.match(
      await window.webContents.executeJavaScript(
        `document.querySelector('[data-todo-id="${repeating.id}"]').textContent`,
      ),
      /本次已完成.*下次/,
    );
    await clickTodo(window, repeating.id);
    await waitFor(
      () => service.store.workspace.todos[0].dueAt === repeatDue,
      '撤销重复事项恢复原时间',
    );
    assert.equal(service.store.workspace.todos[0].notifiedAt, repeating.notifiedAt);
    await window.webContents.executeJavaScript(
      'window.dola.workspace.removeTodo(' + JSON.stringify(repeating.id) + ')',
    );
    await waitFor(() => service.store.workspace.todos.length === 1, '移除重复测试事项');
    await screenshot(window, 'workspace-home');
    console.log('workspace smoke: notes');
    await clickButton(window, '资料与笔记');
    await clickButton(window, '新笔记');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector("input[name=noteTitle]"))',
        ),
      '笔记编辑器',
    );
    await fillFields(window, {
      'input[name=noteTitle]': '课程随记',
      'textarea[name=noteBody]':
        '# 今天的收获\n\n这是本机界面测试创建的笔记。\n\n- 整理概念\n- 记录问题',
    });
    await waitFor(
      () =>
        service.store.workspace.notes[0]?.title === '课程随记' &&
        service.store.workspace.notes[0]?.body.includes('整理概念'),
      '笔记自动保存',
    );
    await screenshot(window, 'workspace-library');
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=导出笔记]").click()',
    );
    await waitFor(() => {
      try {
        return readFileSync(join(output, '课程随记.md'), 'utf8').includes('整理概念');
      } catch {
        return false;
      }
    }, '导出 Markdown');
    await clickButton(window, '关联文件');
    await waitFor(() => service.store.workspace.resources.length === 1, '关联资料文件');
    await clickButton(window, '关联文件夹');
    await waitFor(() => service.store.workspace.resources.length === 2, '关联资料文件夹');
    console.log('workspace smoke: timetable');
    await clickButton(window, '我的课表');
    await clickButton(window, '导入 PDF');
    await waitFor(
      () =>
        window.webContents.executeJavaScript('Boolean(document.querySelector("input[name=term]"))'),
      'PDF 导入预览',
    );
    await fillFields(window, {
      'input[name=term]': '人工测试学期',
      'input[name=firstMonday]': '2026-11-02',
    });
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelectorAll(".course-editor tbody tr").length',
      ),
      2,
    );
    await clickButton(window, '确认保存课表');
    await waitFor(() => service.store.workspace.timetable.courses.length === 2, '课表确认保存');
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=下一周]").click()',
    );
    await screenshot(window, 'workspace-timetable');
    await clickButton(window, '导出日历');
    await waitFor(() => {
      try {
        return readFileSync(join(output, 'NEU-课表.ics'), 'utf8').includes('BEGIN:VEVENT');
      } catch {
        return false;
      }
    }, 'ICS 导出');
    console.log('workspace smoke: graduate web import');
    await runGraduateSmoke(service, window);
    console.log('workspace smoke: mail');
    await clickButton(window, '邮箱');
    await clickButton(window, '添加邮箱');
    const ports = JSON.parse(process.env.DOLA_MAIL_FIXTURE!);
    await fillFields(window, {
      'input[name=mailName]': '本地模拟邮箱',
      'input[name=mailEmail]': 'student@example.test',
      'input[name=mailPassword]': 'fixture-mail-password',
      'input[name=imapHost]': '127.0.0.1',
      'input[name=smtpHost]': '127.0.0.1',
      'input[name=imapPort]': String(ports.imapPort),
      'input[name=smtpPort]': String(ports.smtpPort),
    });
    await window.webContents.executeJavaScript(
      'document.querySelector("input[name=imapTls]").click()',
    );
    await clickButton(window, '保存邮箱');
    await waitFor(
      () =>
        window.webContents.executeJavaScript('Boolean(document.querySelector(".mail-message"))'),
      '实际 IMAP 收件箱',
    );
    await window.webContents.executeJavaScript('document.querySelector(".mail-message").click()');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.querySelector(".mail-detail")?.textContent.includes("Mail fixture body")',
        ),
      'IMAP 读取正文',
    );
    await screenshot(window, 'workspace-mail');
    await window.webContents.executeJavaScript(
      'Array.from(document.querySelectorAll(".mail-attachments button")).find(button=>button.textContent.includes("example.txt")).click()',
    );
    await waitFor(() => {
      try {
        return readFileSync(join(output, 'example.txt'), 'utf8').includes('Attachment fixture');
      } catch {
        return false;
      }
    }, '保存邮件附件');
    await clickButton(window, '写邮件');
    await fillFields(window, {
      'input[name=mailTo]': 'recipient@example.test',
      'input[name=mailSubject]': '桌面发信验证',
      'textarea[name=mailBody]': '这封人工邮件仅发送到本机模拟 SMTP 服务器。',
    });
    await clickButton(window, '发送邮件');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.body.textContent.includes("发件服务器已接收邮件")',
        ),
      '实际 TLS SMTP 发信',
    );
    assert(!JSON.stringify(service.store.snapshot()).includes('fixture-mail-password'));
    console.log('workspace smoke: campus');
    await clickButton(window, '校园入口');
    await clickButton(window, '本科生');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.querySelector(".campus-page")?.textContent.includes("本科教务系统") && !document.querySelector(".campus-page")?.textContent.includes("研究生综合管理")',
        ),
      '本科入口区分',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelectorAll("[data-campus-group=common] .campus-link-card").length',
      ),
      4,
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelector(".campus-page").textContent.includes("错误日志") || document.querySelector(".campus-page").textContent.includes("数据目录")',
      ),
      false,
      '校园页面不显示诊断工具',
    );
    await theme(window, 'light');
    await screenshot(window, 'campus-undergraduate');
    await clickButton(window, '研究生');
    await waitFor(() => service.store.workspace.degree === 'graduate', '切换学生类型');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'document.querySelector(".campus-page")?.textContent.includes("研究生综合管理") && !document.querySelector(".campus-page")?.textContent.includes("本科教务系统")',
        ),
      '研究生入口区分',
    );
    await screenshot(window, 'campus-graduate');
    await theme(window, 'dark');
    await clickButton(window, '设置');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".settings-support"))',
        ),
      '设置帮助入口',
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelector(".settings-support").open',
      ),
      false,
      '帮助与诊断默认折叠',
    );
    await window.webContents.executeJavaScript(
      'document.querySelector(".settings-support summary").click();document.querySelector(".settings-support").scrollIntoView({block:"center"});',
    );
    await screenshot(window, 'settings-support');
    await clickButton(window, '查看错误日志');
    await waitFor(
      () =>
        window.webContents.executeJavaScript(
          'Boolean(document.querySelector(".diagnostics-text"))',
        ),
      '错误日志入口',
    );
    await window.webContents.executeJavaScript(
      'document.querySelector("button[aria-label=关闭弹窗]").click()',
    );
    await clickButton(window, '返回');
  } finally {
    dialog.showOpenDialog = originalOpen;
    dialog.showSaveDialog = originalSave;
  }
}

export async function runDesktopSmoke(service: ChatService, window: BrowserWindow) {
  mkdirSync(output, { recursive: true });
  await ready(window);
  const windowCount = BrowserWindow.getAllWindows().length;
  window.close();
  assert(!window.isDestroyed());
  assert(!window.isVisible());
  app.emit('activate');
  await waitFor(() => window.isVisible(), '关闭到后台后重新激活主窗口');
  assert.equal(BrowserWindow.getAllWindows().length, windowCount);
  await theme(window, 'dark');
  assert.equal(
    await window.webContents.executeJavaScript(
      'Boolean(document.querySelector(".dashboard-page"))',
    ),
    true,
    '默认打开工作台首页',
  );
  assert.deepEqual(
    await window.webContents.executeJavaScript(
      'Array.from(document.querySelectorAll(".dashboard-stat > strong")).map(node => Number(node.textContent))',
    ),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    await window.webContents.executeJavaScript(`(() => ({
      focus: document.querySelector('.dashboard-focus')?.dataset.focusKind,
      setupAction: document.querySelector('.dashboard-focus-action')?.textContent.trim(),
      agenda: document.querySelector('.agenda-empty strong')?.textContent,
      todo: document.querySelector('.dashboard-todos .dashboard-empty strong')?.textContent,
      notes: document.querySelector('.dashboard-notes .dashboard-empty strong')?.textContent,
      courseCount: document.querySelectorAll('[data-agenda-course]').length,
      todoCount: document.querySelectorAll('[data-todo-id]').length,
    }))()`),
    {
      focus: 'empty',
      setupAction: '设置课表',
      agenda: '从一张课表开始',
      todo: '暂时没有未完成的事',
      notes: '留一个地方，放下想法',
      courseCount: 0,
      todoCount: 0,
    },
    '无数据时显示课表设置、待办与笔记引导，不伪造安排',
  );
  await screenshot(window, 'dashboard-empty');
  await window.webContents.executeJavaScript(
    'document.querySelector(".dashboard-focus-action").click()',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript('Boolean(document.querySelector(".calendar-scroll"))'),
    '首页空白引导进入课表设置',
  );
  await clickButton(window, '工作台首页');
  await runWorkspaceSmoke(service, window);
  await runNotesSmoke(service, window);
  await runThemeSmoke(service, window);
  await runCourseColorSmoke(service, window);
  await runDashboardSmoke(service, window);
  await runLearningWorkflowSmoke(service, window);
  await clickButton(window, 'AI 助手');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("textarea[name=prompt]"))',
      ),
    '进入 AI 对话',
  );
  const isolation = await window.webContents.executeJavaScript(
    '({require:typeof window.require,process:typeof window.process})',
  );
  assert.deepEqual(isolation, { require: 'undefined', process: 'undefined' });
  const snapshot = JSON.stringify(service.store.snapshot());
  const secrets = [
    ...service.store.providers.map((provider) => service.store.key(provider.id)),
    ...service.store.workspace.mailAccounts.map((account) =>
      service.store.key('mail:' + account.id),
    ),
  ];
  for (const secret of secrets)
    if (secret) assert(!snapshot.includes(secret), '界面快照不应包含已保存凭据');
  await screenshot(window, 'ai-home');
  await clickButton(window, '模型设置');
  await waitFor(
    () =>
      window.webContents.executeJavaScript('Boolean(document.querySelector("input[name=apiKey]"))'),
    '模型设置页',
  );
  const savedKeyInput = await window.webContents.executeJavaScript(
    'document.querySelector("input[name=apiKey]").value',
  );
  assert.equal(savedKeyInput, '');
  await chooseOption(window, 'protocol', 'openai-responses');
  assert.equal(
    await window.webContents.executeJavaScript('document.querySelectorAll("select").length'),
    0,
  );
  assert.equal(
    await window.webContents.executeJavaScript(
      'document.querySelector("input[name=maxOutputTokens]") === null && !document.querySelector(".provider-form").textContent.includes("最大输出 Token")',
    ),
    true,
  );
  await clickButton(window, '获取模型');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("[data-select=model]"))',
      ),
    '使用已保存密钥获取模型列表',
  );
  await screenshot(window, 'ai-settings');
  await window.webContents.executeJavaScript(
    'document.querySelector("[data-select=model]").click()',
  );
  await waitFor(
    () => window.webContents.executeJavaScript('Boolean(document.querySelector(".select-menu"))'),
    '打开主题模型列表',
  );
  assert.equal(
    await window.webContents.executeJavaScript(
      'getComputedStyle(document.querySelector(".select-menu")).backgroundColor === getComputedStyle(document.querySelector(".provider-form")).backgroundColor',
    ),
    true,
  );
  await darkSurface(window, '.select-menu');
  await screenshot(window, 'ai-settings-menu');
  window.setSize(1024, 700);
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        '(() => {const rect=document.querySelector(".select-menu").getBoundingClientRect(); return rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;})()',
      ),
    '小窗口列表不被裁切',
  );
  window.setSize(1360, 900);
  await window.webContents.executeJavaScript(
    '(() => {const input=document.querySelector(".select-menu input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"compatible"); input.dispatchEvent(new Event("input",{bubbles:true}));})()',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelectorAll(".select-menu [role=option]").length === 1',
      ),
    '搜索模型',
  );
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  await waitFor(
    () => window.webContents.executeJavaScript('!document.querySelector(".select-menu")'),
    '键盘选择模型',
  );
  await clickButton(window, '手动输入模型 ID');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector("input[name=model]")?.value === "dola-mock-compatible"',
      ),
    '选择模型后仍可切回手动输入',
  );
  await clickButton(window, '保存并测试');
  await waitFor(
    () => window.webContents.executeJavaScript('document.body.textContent.includes("连接成功")'),
    '通过设置页保存并测试模型',
  );
  await clickButton(window, 'OpenAI 接口');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector("input[name=providerName]")?.value === "OpenAI"',
      ),
    '添加新模型服务',
  );
  const baseUrl = service.store.providers[0].baseUrl.replace(/\/v1$/, '');
  await window.webContents.executeJavaScript(
    '(() => {const fields=' +
      JSON.stringify({ baseUrl: baseUrl + '/v1', apiKey: 'fixture-new-models-key' }) +
      '; for(const [name,value] of Object.entries(fields)){' +
      'const input=document.querySelector("input[name="+name+"]");' +
      'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);' +
      'input.dispatchEvent(new Event("input",{bubbles:true}));}})()',
  );
  await clickButton(window, '获取模型');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("[data-select=model]"))',
      ),
    '模型 ID 留空且配置未保存时获取模型',
  );
  assert.equal(service.store.providers.length, 3);
  const fields = {
    providerName: '错误入口测试',
    baseUrl: baseUrl + '/wrong/v1',
    apiKey: 'fixture-wrong-route',
  };
  await window.webContents.executeJavaScript(
    '(() => {const fields=' +
      JSON.stringify(fields) +
      '; for(const [name,value] of Object.entries(fields)){' +
      'const input=document.querySelector("input[name="+name+"]");' +
      'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);' +
      'input.dispatchEvent(new Event("input",{bubbles:true}));}})()',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript('Boolean(document.querySelector("input[name=model]"))'),
    '修改连接信息后清除旧模型列表',
  );
  await clickButton(window, '获取模型');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.querySelector(".model-notice")?.textContent.includes("获取失败")',
      ),
    '模型列表接口失败时显示提示并保留手动输入',
  );
  await clickButton(window, '保存并测试');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.body.textContent.includes("服务已保存，连接测试失败")' +
          ' && document.querySelector(".form-heading h2")?.textContent === "编辑模型服务"',
      ),
    '测试失败后仍保留已保存服务的身份',
  );
  assert.equal(service.store.providers.length, 4);
  const failedProvider = service.store.providers.find((p) => p.name === '错误入口测试')!;
  await clickButton(window, '保存服务');
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'document.body.textContent.includes("模型服务已保存，可以开始对话")',
      ),
    '失败后再次保存',
  );
  assert.equal(service.store.providers.length, 4);
  await window.webContents.executeJavaScript(
    'window.dola.removeProvider(' + JSON.stringify(failedProvider.id) + ')',
  );
  await clickButton(window, '返回');
  const firstProvider = service.store.providers.find((p) => p.protocol === 'openai-responses')!;
  await chooseOption(window, 'chat-model', JSON.stringify([firstProvider.id, 'dola-mock-claude']));
  await fillAndSend(window, '帮我安排今天的学习，先询问我的任务与截止时间。');
  await waitFor(
    () => service.store.chats[0]?.messages.at(-1)?.state === 'complete',
    'OpenAI Responses 对话完成',
  );
  assert(service.store.chats[0].messages.at(-1)?.text.includes('OpenAI Responses'));
  assert.equal(service.store.chats[0].messages.at(-1)?.model, 'dola-mock-claude');
  await screenshot(window, 'ai-chat');

  const id = service.store.chats[0].id;
  await window.webContents.executeJavaScript(
    'document.querySelector("[data-select=chat-model]").click()',
  );
  await waitFor(
    () => window.webContents.executeJavaScript('Boolean(document.querySelector(".select-menu"))'),
    '聊天模型面板',
  );
  await screenshot(window, 'ai-model-switcher');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await waitFor(
    () => window.webContents.executeJavaScript('!document.querySelector(".select-menu")'),
    'Escape 关闭列表',
  );
  await chooseOption(window, 'chat-model', JSON.stringify([firstProvider.id, 'dola-mock-openai']));
  await waitFor(() => service.store.chat(id).model === 'dola-mock-openai', '同一服务内切换模型');
  await fillAndSend(window, '使用刚刚选择的模型继续说明');
  await waitFor(
    () =>
      service.store.chat(id).messages.length === 4 &&
      service.store.chat(id).messages.at(-1)?.state === 'complete',
    '切换模型后的回复',
  );
  assert.equal(service.store.chat(id).messages.at(-1)?.model, 'dola-mock-openai');
  assert.equal(service.store.provider(firstProvider.id).model, 'dola-mock-compatible');
  for (const protocol of ['anthropic', 'openai-chat'] as const) {
    const provider = service.store.providers.find((p) => p.protocol === protocol)!;
    await chooseOption(window, 'chat-model', JSON.stringify([provider.id, provider.model]));
    await waitFor(() => service.store.chat(id).providerId === provider.id, '界面切换 ' + protocol);
    const previous = service.store.chat(id).messages.length;
    await fillAndSend(window, '请继续说明，当前模型接口是 ' + protocol);
    await waitFor(
      () =>
        service.store.chat(id).messages.length === previous + 2 &&
        service.store.chat(id).messages.at(-1)?.state === 'complete',
      protocol + ' 对话完成',
    );
  }
  await fillAndSend(window, '[slow] 测试停止生成');
  await waitFor(
    () => Boolean(service.store.chat(id).messages.at(-1)?.text) && service.busy(id),
    '收到部分流式文字',
  );
  await window.webContents.executeJavaScript(
    'document.querySelector("button[aria-label=停止生成]").click()',
  );
  await waitFor(
    () => service.store.chat(id).messages.at(-1)?.state === 'stopped',
    '停止按钮中断请求',
  );
  await waitFor(
    () =>
      window.webContents.executeJavaScript(
        'Boolean(document.querySelector("button[aria-label=发送消息]"))',
      ),
    '停止后恢复发送',
  );
  await fillAndSend(window, '[http401]');
  await waitFor(
    () => service.store.chat(id).messages.at(-1)?.state === 'error',
    'HTTP 401 错误状态',
  );
  await waitFor(
    () => window.webContents.executeJavaScript('document.body.textContent.includes("API Key")'),
    '错误提示展示',
  );
  const finalSnapshot = JSON.stringify(service.store.snapshot());
  for (const provider of service.store.providers) {
    const secret = service.store.key(provider.id);
    if (secret) assert(!finalSnapshot.includes(secret), '界面快照不应包含模型密钥');
  }
  assert(!finalSnapshot.includes('fixture-mail-password'));
  const workbench = await runAssistantSmoke(service, window);
  writeFileSync(
    join(output, 'desktop.json'),
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        protocols: service.store.providers.map((p) => p.protocol),
        plainChatId: id,
        workbenchChatId: workbench.id,
        workbenchReads: workbench.reads,
        workbenchSources: workbench.sources,
        checks: [
          '便利贴创建、勾选与本地保存',
          '完成卡片原位保留、主动收起与恢复',
          '深浅完成反馈与完成状态即时落盘',
          '重复提醒快速双击与撤销恢复时间',
          '首页完成保留与撤销计数联动',
          '笔记编辑与自动保存',
          '笔记本创建重命名与正文搜索',
          '笔记置顶及清单完成恢复且不修改代码示例',
          '备忘录深浅主题与小窗口编辑布局',
          '笔记提问只准备草稿且不自动发送',
          '离开笔记立即保存并由AI读取最新正文',
          'PDF实际导入、预览与课程确认',
          '学校登录窗口与应用接口隔离',
          '关闭到后台后重新激活原窗口',
          '未登录提示及取消网页导入保留旧课表',
          '内嵌网页课表读取且忽略隐藏旧页面',
          '网页课表预览确认与来源恢复',
          'ICS日历导出',
          '资料文件与文件夹关联',
          '邮箱账号加密保存',
          '实际IMAP读信与附件保存',
          '实际TLS SMTP发信',
          '校园入口与设置中的诊断可查看',
          '本科研究生入口区分与身份持久化',
          'preload隔离',
          '配置不回传密钥',
          '输出Token选项已移除',
          '已保存密钥获取模型',
          '模型选择与手动输入',
          '未保存配置获取模型',
          '模型列表失败后可手动填写',
          '应用内主题列表',
          '浅色深色及系统主题切换',
          '工作台弹窗及学校工具栏主题适配',
          '切换主题保留未发送输入',
          '小窗口外观入口可见',
          '重启保留外观选择',
          '不同课程及跨天同名课程配色',
          '切周及切换深浅模式保持课程色系',
          '深浅课表文字对比度',
          '默认工作台首页空白引导及课表设置入口',
          '首页课程待办笔记及邮箱汇总',
          '首页新建完成与便利贴状态联动',
          '首页快捷跳转及指定笔记继续编辑',
          '工作台深浅主题及小窗口布局',
          '七天日程连续日期切换与课程待办合并',
          '逾期和无时间待办单列且课程冲突可见',
          '日程打开准确日期课程与待办编辑',
          '课程笔记预填日期时间地点教师与笔记本',
          '全局搜索快捷键与笔记正文待办课程定位',
          '重复搜索同一笔记待办课程仍准确打开',
          '刚编辑的笔记在搜索前立即保存',
          '课程笔记及资料按同名分类筛选',
          '日程搜索深浅主题与小窗口布局',
          '搜索历史对话和点击当前对话保留未发送草稿',
          '学习工作流无模型请求且隔离数据恢复',
          '模型搜索与键盘选择',
          '小窗口列表不裁切',
          '聊天快捷选择模型',
          '同一服务内切换模型并保留默认值',
          '设置页保存并探测',
          '探测失败后重试不重复创建服务',
          '三协议界面对话',
          '多轮历史',
          '停止生成',
          '401错误提示',
          '用户头像与深浅主题',
          'AI真实读取课表待办笔记及关联PDF文本',
          'AI只读邮件目录与正文',
          '读取过程来源展示与笔记定位',
          '工作台访问关闭及小窗口聊天',
          '重启恢复读取记录与引用',
        ],
        messages: service.store.chat(id).messages.length,
      },
      null,
      2,
    ),
  );
}

export async function runRestoreSmoke(service: ChatService, window: BrowserWindow) {
  await ready(window);
  assert.equal(
    await window.webContents.executeJavaScript(
      'Boolean(document.querySelector(".dashboard-page"))',
    ),
    true,
    '重启默认回到工作台首页',
  );
  assert.equal(service.store.theme, 'dark');
  assert.equal(nativeTheme.themeSource, 'dark');
  await waitFor(
    async () =>
      (await window.webContents.executeJavaScript('document.documentElement.dataset.theme')) ===
      'dark',
    '重启后的深色外观',
  );
  assert.equal(service.store.providers.length, 3);
  const data = JSON.parse(readFileSync(join(output, 'desktop.json'), 'utf8'));
  assert.equal(service.store.chats.length, 2);
  const messages = service.store.chat(data.plainChatId).messages;
  const workbenchChat = service.store.chat(data.workbenchChatId);
  assert.equal(workbenchChat.workspaceAccess, false);
  assert.equal(workbenchChat.messages[1].sources?.length, data.workbenchSources);
  assert.equal(workbenchChat.messages[1].activity?.length, 12);
  assert(workbenchChat.messages[1].activity?.every((step) => step.status === 'done'));
  assert.equal(service.store.workspace.todos.length, 1);
  assert.equal(service.store.workspace.notes[0].title, '课程随记');
  assert.equal(service.store.workspace.timetable.courses.length, 3);
  assert.equal(
    service.store.workspace.timetable.sourceUrl,
    'https://yjs.neu.edu.cn/fixture-courses',
  );
  assert.equal(service.store.workspace.resources.length, 2);
  assert.equal(service.store.workspace.mailAccounts.length, 1);
  assert.equal(service.store.workspace.degree, 'graduate');
  assert.equal(
    service.store.key('mail:' + service.store.workspace.mailAccounts[0].id),
    'fixture-mail-password',
  );
  assert.equal(messages.length, 12);
  assert.equal(messages.at(-1)?.state, 'error');
  assert(messages.some((m) => m.state === 'stopped'));
  for (const provider of service.store.providers)
    assert(service.store.key(provider.id).startsWith('fixture-'));
  const openai = service.store.providers.find(
    (provider) => provider.protocol === 'openai-responses',
  )!;
  assert.equal(openai.models?.length, 3);
  writeFileSync(
    join(output, 'desktop.json'),
    JSON.stringify(
      {
        ...data,
        restartRestore: true,
        keychainDecryptAfterRestart: true,
        modelListRestore: true,
        workspaceRestore: true,
      },
      null,
      2,
    ),
  );
}
