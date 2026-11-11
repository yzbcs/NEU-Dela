// A disposable desktop bridge for the public tour. All demo data lives in this iframe.
(() => {
  const RealDate = Date;
  const demoTime = RealDate.parse('2026-11-09T09:05:00+08:00');
  const startedAt = performance.now();
  window.Date = class TourDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [TourDate.now()]));
    }
    static now() {
      return demoTime + performance.now() - startedAt;
    }
  };

  // Keep desktop focus and auto-scroll from moving the visitor's outer page.
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options) {
    focus.call(this, {...options, preventScroll: true});
  };
  Element.prototype.scrollIntoView = function (options) {
    const align = typeof options === 'object' ? options?.block ?? 'start' : options === false ? 'end' : 'start';
    for (let parent = this.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (!['auto', 'scroll'].includes(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight + 1) continue;
      const target = this.getBoundingClientRect();
      const bounds = parent.getBoundingClientRect();
      if (align === 'start') parent.scrollTop += target.top - bounds.top - 12;
      else if (align === 'end') parent.scrollTop += target.bottom - bounds.bottom + 12;
      else if (align === 'center') parent.scrollTop += (target.top + target.bottom - bounds.top - bounds.bottom) / 2;
      else if (target.top < bounds.top) parent.scrollTop += target.top - bounds.top - 12;
      else if (target.bottom > bounds.bottom) parent.scrollTop += target.bottom - bounds.bottom + 12;
    }
  };

  const clone = structuredClone;
  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const chapter = Number(new URLSearchParams(location.search).get('chapter') || 0);
  const cache = new Map();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: key => cache.get(key) ?? null,
      setItem: (key, value) => cache.set(key, String(value)),
      removeItem: key => cache.delete(key),
    },
  });

  const course = (name, day, start, end, location, detail = '', weeks = '1-16') => ({
    id: id(), name, day, start, end, weeks, location, teacher: '', detail,
  });
  const initialCourse = course('机器学习', 1, 1, 2, '信息学馆 A301', '本周主题：L2 正则化与过拟合。');
  const imported = [
    initialCourse,
    course('数据挖掘', 2, 3, 4, '信息学馆 A204'),
    course('自然语言处理', 5, 3, 4, '信息学馆 A402'),
  ];
  const todo = (title, detail, dueAt, options = {}) => ({
    id: id(), title, detail, dueAt, color: 'yellow', reminder: false, repeat: 'none',
    done: false, notifiedAt: '', createdAt: now(), ...options,
  });
  const note = (title, body) => ({id: id(), title, body, category: '机器学习', updatedAt: now()});
  const prep = todo('课前阅读：正则化讲义', '带着一个关于过拟合的问题去上课。', '2026-11-09T20:00:00+08:00');
  const lab = todo('对比训练误差与验证误差', '固定数据划分和随机种子，比较无正则化与 L2 正则化。', '2026-11-12T20:00:00+08:00', {color: 'blue', reminder: true});
  const review = course('机器学习答疑', 3, 5, 6, '信息学馆 B204', '准备一个关于过拟合的问题。', '1');
  const outline = note('正则化｜答疑复习提纲', '## 复习要点\nL2 正则化惩罚过大的权重，有助于控制过拟合。\n\n## 对照实验\n- 固定数据划分和随机种子。\n- 比较无正则化与 L2 的训练、验证误差。\n\n## 答疑前核对\n- [ ] 记下两组误差及差距。\n- [ ] 思考：L2 太强时，为什么会欠拟合？');
  const classNote = note('机器学习｜L2 正则化课堂笔记', '## 课堂要点\nL2 惩罚过大的权重，帮助控制过拟合。\n\n## 实验清单\n- [ ] 固定数据划分与随机种子。\n- [ ] 对比无正则化与 L2 的训练、验证误差。\n\n## 留给答疑的问题\n正则化太强时，为什么会欠拟合？');
  const subject = '机器学习课程提醒：本周答疑与复习安排';
  const mail = {
    uid: 1, subject, from: '机器学习课程组 <course@example.edu>', to: 'student@example.edu',
    date: '2026-11-09T08:00:00+08:00', seen: false, attachments: [],
    text: '同学们好，\n\n本周三第 5–6 节（14:00–15:40）在信息学馆 B204 开放机器学习答疑。\n\n请复习 L2 正则化，对比无正则化与使用 L2 时的训练、验证误差。\n周四 20:00 前记录两组实验结果，并准备一个关于过拟合的问题。\n\n机器学习课程组',
  };
  const fileBodies = {
    '正则化实验讲义.md': '# 正则化实验讲义\n\n## 复习目标\n理解 L2 正则化为什么能控制过拟合，以及强度过大时为什么会欠拟合。\n\n## 做一个对照实验\n1. 固定训练集、验证集的划分和随机种子。\n2. 对比不加正则化与加入 L2 两组设置。\n3. 记录训练误差、验证误差和两者的差距。\n\n| 设置 | 训练误差 | 验证误差 |\n| --- | --- | --- |\n| 不加正则化 | 待测 | 待测 |\n| L2 正则化 | 待测 | 待测 |\n\n## 留给答疑的问题\n如果 L2 惩罚过强，模型会发生什么变化？',
    '实验记录模板.md': '# 训练误差与验证误差\n\n填入两组实验的配置与结果。',
  };
  const resource = {id: id(), title: '机器学习资料', kind: 'folder', path: '/演示资料/机器学习', category: '机器学习', addedAt: now()};
  const provider = {id: id(), name: '本地模拟 · 演示', protocol: 'openai-responses', baseUrl: 'https://example.invalid/v1', model: 'dola-mock-tour', hasKey: true};
  const account = {id: id(), name: '示例校园邮箱', email: mail.to, username: mail.to, imapHost: 'imap.example.edu', imapPort: 993, imapTls: true, smtpHost: 'smtp.example.edu', smtpPort: 465, smtpTls: true, hasPassword: true};
  const state = {
    theme: 'light', providers: [provider], chats: [],
    workspace: {
      degree: 'graduate', degreeConfirmed: true,
      timetable: {
        term: '2026 秋季 · 演示周', firstMonday: '2026-11-09', sourcePath: '',
        sourceName: chapter >= 3 ? '2026秋季课表.pdf' : '', courses: chapter >= 3 ? [...imported] : [initialCourse],
      },
      todos: [prep],
      notes: [note('上周笔记｜训练集与验证集', '训练集用于拟合模型，验证集用于比较超参数。')],
      notebooks: ['机器学习'], resources: [resource], mailAccounts: [account],
    },
  };
  const w = state.workspace;
  if (chapter >= 5) w.notes.push(classNote);
  if (chapter >= 6) {
    w.timetable.courses.push(review);
    w.todos.push(lab);
    w.notes.push(outline);
  }
  if (chapter >= 7) prep.done = true;
  const listeners = new Set();
  const publish = () => { for (const listener of listeners) listener(clone(state)); };
  const replace = (records, record) => {
    const i = records.findIndex(item => item.id === record.id);
    if (i < 0) records.push(record);
    else records[i] = record;
    publish();
    return record.id;
  };
  const mailPage = () => ({
    messages: [mail, {uid: 2, subject: '实验报告提交说明', from: '课程助教 <ta@example.edu>', date: '2026-11-08T17:00:00+08:00', seen: true}],
    total: 2, page: 1, syncedAt: now(), uidValidity: '1',
  });

  window.dola = {
    updates: {
      getState: async () => ({status: 'unavailable', currentVersion: '0.7.7'}),
      check: async () => ({status: 'unavailable', currentVersion: '0.7.7'}),
      download: async () => ({status: 'unavailable', currentVersion: '0.7.7'}),
      cancel: async () => {},
      install: async () => {},
      confirmLaunch: async () => {},
      onChange: () => () => {},
      onOpen: () => () => {},
    },
    load: async () => clone(state),
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    onOpenTodo: () => () => {},
    setTheme: async theme => { state.theme = theme; publish(); },
    createChat: async (providerId, model) => {
      const chat = {id: id(), title: '新对话', providerId, model, messages: [], updatedAt: now()};
      state.chats.unshift(chat);
      publish();
      return chat.id;
    },
    send: async (chatId, text) => {
      const chat = state.chats.find(item => item.id === chatId);
      const readingFile = text.includes('请读取本地资料《正则化实验讲义.md》');
      chat.title = readingFile ? '读讲义｜正则化对照实验' : '机器学习｜答疑复习安排';
      const reply = {id: id(), role: 'assistant', text: '', state: 'streaming', model: provider.model, createdAt: now()};
      chat.messages.push({id: id(), role: 'user', text, state: 'complete', createdAt: now()}, reply);
      publish();
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (readingFile) {
        reply.text = '固定训练集、验证集和随机种子，是为了让两组实验只在是否使用 L2 上有区别。比较训练误差、验证误差和两者的差距，就能判断 L2 是否改善了泛化。';
        reply.sources = [{kind: 'resource', id: resource.id, path: '正则化实验讲义.md', label: '正则化实验讲义.md', citation: 1}];
        reply.state = 'complete';
        publish();
        return;
      }
      const additions = [
        ['course', w.timetable.courses, review, '已追加 1 门课程，原课表保留。'],
        ['todo', w.todos, lab, '已设置周四 20:00 的实验提醒。'],
        ['note', w.notes, outline, '已整理实验步骤和答疑核对清单。'],
      ];
      reply.creations = additions.map(([kind, list, record, detail]) => {
        if (!list.some(item => item.id === record.id)) list.push(record);
        return {id: id(), kind, record, detail, status: 'created'};
      });
      reply.text = '补课、实验提醒和复习提纲都已保存。可以从下面的卡片打开对应记录。';
      reply.state = 'complete';
      publish();
    },
    chooseChatAttachments: async () => [],
    discardChatAttachments: async () => {},
    openChatAttachment: async () => {},
    workspace: {
      importTimetable: async () => clone({sourceName: '2026秋季课表.pdf', sourcePath: '', term: w.timetable.term, courses: imported, text: '', warnings: []}),
      saveTimetable: async table => { w.timetable = clone(table); publish(); },
      saveNote: async input => replace(w.notes, {...input, id: input.id ?? id(), updatedAt: now()}),
      saveTodo: async input => {
        const old = w.todos.find(item => item.id === input.id);
        replace(w.todos, {...old, ...input, id: input.id ?? id(), createdAt: old?.createdAt ?? now(), notifiedAt: old?.notifiedAt ?? ''});
      },
      toggleTodo: async key => {
        const item = w.todos.find(row => row.id === key);
        if (item) { item.done = !item.done; publish(); }
      },
      undoTodo: async (key, previous) => {
        const item = w.todos.find(row => row.id === key);
        if (item) { Object.assign(item, previous); publish(); }
      },
      listResourceDirectory: async () => ({name: resource.title, path: '', entries: Object.keys(fileBodies).map(name => ({name, path: name, kind: 'file'})), total: Object.keys(fileBodies).length, nextOffset: null}),
      readResourceFile: async (_key, path) => {
        if (!Object.hasOwn(fileBodies, path)) throw Error('演示文件不存在');
        const body = fileBodies[path];
        return {name: path, path, fullPath: resource.path + '/' + path, kind: 'markdown', body, size: new TextEncoder().encode(body).length, modifiedAt: now()};
      },
      mailList: async () => clone(mailPage()),
      mailCached: async () => clone(mailPage()),
      mailRead: async () => { mail.seen = true; return clone(mail); },
      setDegree: async degree => { w.degree = degree; w.degreeConfirmed = true; publish(); },
      getAppInfo: async () => ({version: '0.7.7', dataDirectory: '/演示工作台'}),
    },
  };
})();
