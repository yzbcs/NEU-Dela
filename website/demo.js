const stage = document.querySelector('.preview-frame');
const app = document.querySelector('#demo-app');
const pointer = document.querySelector('#demo-pointer');
const play = document.querySelector('#preview-play');
const nav = document.querySelector('#preview-nav');
const name = document.querySelector('#preview-name');
const description = document.querySelector('#preview-description');
const badge = document.querySelector('#tour-step');
const progress = document.querySelector('#tour-progress');
const numbered = n => String(n).padStart(2, '0');
const button = (label, scope = '', partial = false) => document =>
  [...document.querySelectorAll(scope ? scope + ' button' : 'button')].find(element =>
    partial ? element.textContent.trim().startsWith(label) : element.textContent.trim() === label,
  );
const sidebar = label => button(label, '.workspace-nav');
const aria = (label, tag = 'button') => tag + '[aria-label="' + label + '"]';

const noteTitle = '机器学习｜L2 正则化课堂笔记';
const noteBody = '## 课堂要点\nL2 惩罚过大的权重，帮助控制过拟合。\n\n## 实验清单\n- [ ] 固定数据划分与随机种子。\n- [ ] 对比无正则化与 L2 的训练、验证误差。\n\n## 留给答疑的问题\n正则化太强时，为什么会欠拟合？';
const prompt = '把周三第5–6节机器学习答疑（信息学馆 B204）加进课表；周四20:00提醒我对比训练与验证误差；把 L2 正则化实验步骤整理成笔记。';

const chapters = [
  ['首页', '先看看今天要做什么', async tour => {
    await tour.read('首页把正在上的机器学习课和「课前阅读：正则化讲义」放在一起。', 2100);
    await tour.click('.agenda-days button:nth-child(2)');
    await tour.read('点击日期切换未来七天的安排，也可以从右边继续处理待办。', 2000);
  }],
  ['邮箱', '从课程通知里找出时间和任务', async tour => {
    await tour.click(sidebar('邮箱'));
    await tour.read('已配置的邮箱可以直接在工作台收取邮件。打开「机器学习课程提醒」。', 1800);
    await tour.click('.mail-message');
    await tour.find('.mail-detail');
    await tour.read('邮件里有两件事：周三 14:00 到信息学馆 B204 答疑；周四 20:00 前记录两组实验误差。', 3800);
    await tour.click(button('回复', '.mail-detail'));
    await tour.read('需要确认安排时，点「回复」会带入收件人和邮件主题。', 1500);
    await tour.click(aria('关闭弹窗'));
  }],
  ['课表', '导入课表，再打开机器学习课程', async tour => {
    await tour.click(sidebar('我的课表'));
    await tour.read('这次用「2026秋季课表.pdf」演示导入。App 也提供研究生系统网页导入和手动编辑。', 2100);
    await tour.click(button('导入 PDF'));
    await tour.find('.course-editor');
    await tour.read('核对机器学习、数据挖掘和自然语言处理的节次、周次和地点，再保存。', 2900);
    await tour.click(button('确认保存课表'));
    await tour.click(button('机器学习', '.calendar-day-courses', true));
    await tour.read('周一第 1–2 节在 A301。课程详情还可以打开同名笔记和资料，或直接新建课堂笔记。', 2800);
    await tour.click(aria('关闭弹窗'));
  }],
  ['本地资料', '打开讲义，找到对照实验的做法', async tour => {
    await tour.click(sidebar('资料与笔记'));
    await tour.click(button('本地资料', '.segment-tabs', true));
    await tour.click(button('机器学习资料', '.local-tree'));
    await tour.click(button('正则化实验讲义.md', '.local-tree'));
    await tour.find('.local-markdown');
    await tour.read('讲义要求固定训练集、验证集和随机种子，比较无正则化与加入 L2 的误差。', 3300);
    await tour.click(button('询问这份资料'));
    await tour.find('.composer textarea');
    await tour.read('「询问这份资料」会在 AI 助手里准备好提问草稿。可以先检查要问的内容，再发送。', 2300);
    await tour.click(aria('发送消息'));
    await tour.find('.message-sources button');
    await tour.read('AI 给出对照实验的解释，并附上讲义来源。点来源可以回到原文件核对。', 2800);
    await tour.click('.message-sources button');
  }],
  ['课堂笔记', '把三件要记的事整理进课程笔记', async tour => {
    await tour.click(sidebar('我的课表'));
    await tour.click(button('机器学习', '.calendar-day-courses', true));
    await tour.click(button('新建本次课程笔记'));
    await tour.find('input[name="noteTitle"]');
    await tour.read('从课程详情新建，笔记会直接归到「机器学习」笔记本。', 1500);
    await tour.type('input[name="noteTitle"]', noteTitle, 65);
    await tour.type('textarea[name="noteBody"]', noteBody, 26, 3);
    await tour.click(button('阅读模式'));
    await tour.find('.note-preview');
    await tour.read('记下 L2 如何控制过拟合、两组实验怎么比较，以及想问老师的问题：L2 太强时为什么会欠拟合？', 3500);
  }],
  ['AI 助手', '让 AI 加课、设提醒、整理复习提纲', async tour => {
    await tour.click('.new-chat');
    await tour.read('在同一条消息里说清楚课程时间、提醒时间和需要整理的笔记。', 1400);
    await tour.type('.composer textarea', prompt, 68);
    await tour.read('周三第 5–6 节到 B204 答疑；周四 20:00 对比两组误差；把 L2 实验步骤整理成提纲。', 3000);
    await tour.click(aria('发送消息'));
    await tour.find('.creation-card[data-kind="note"]');
    await tour.reveal('.creation-card[data-kind="course"]', 'start');
    await tour.read('结果卡确认了「机器学习答疑」和「对比训练误差与验证误差」提醒。', 2800);
    await tour.reveal('.creation-card[data-kind="note"]', 'end');
    await tour.read('「正则化｜答疑复习提纲」包括 L2 的作用、对照实验步骤和答疑前的核对清单。', 3400);
    await tour.click(aria('查看记录 机器学习答疑'));
    await tour.find('.course-detail');
    await tour.read('点击结果卡上的「查看并编辑」，能回到课表核对新加的答疑课和 B204 教室。', 2600);
    await tour.click(aria('关闭弹窗'));
  }],
  ['待办提醒', '核对实验提醒，再勾掉读完的讲义', async tour => {
    await tour.click(sidebar('今日便利贴'));
    await tour.click(aria('编辑 对比训练误差与验证误差'));
    await tour.read('这条蓝色便利贴已开启定时提醒，截止时间是周四 20:00。还可以调整时间或设置重复。', 3300);
    await tour.click(aria('关闭弹窗'));
    await tour.click(aria('完成 课前阅读：正则化讲义'));
    await tour.find(aria('恢复 课前阅读：正则化讲义'));
    await tour.read('讲义已读完，点击勾选。完成的卡片仍在原位，点一下就能恢复。', 2400);
  }],
  ['全局搜索', '搜「正则化」，从结果回到笔记', async tour => {
    await tour.click('.workspace-search-trigger');
    await tour.type(aria('搜索工作台内容', 'input'), '正则化', 250);
    await tour.find('[data-search-kind="note"]');
    await tour.read('同一个搜索框会查课程、待办、笔记、资料名称和聊天。可以用上方按钮筛类型。', 2600);
    await tour.click(document => [...document.querySelectorAll('[data-search-kind="note"]')].find(item => item.textContent.includes('答疑复习提纲')));
    await tour.find('input[name="noteTitle"]');
    await tour.read('点「正则化｜答疑复习提纲」，就能打开 AI 刚刚存下来的原笔记。', 2400);
  }],
  ['校园入口', '把学校服务放到同一个入口', async tour => {
    await tour.click(sidebar('校园入口'));
    await tour.read('研究生常用入口集中放在这里，点击服务会在系统浏览器打开。', 2200);
    await tour.click(button('本科生', '.campus-page'));
    await tour.read('切到本科生后会显示对应服务，校园通用入口也在同一页。', 2200);
  }],
  ['设置', '找到模型、邮箱、提醒和外观', async tour => {
    await tour.click(button('设置', '.sidebar-bottom'));
    await tour.read('设置总览可以管理邮箱、模型、学期节次、提醒和本机数据。', 2200);
    await tour.click('[data-settings-open="models"]');
    await tour.find('.settings-models');
    await tour.read('模型服务提供 DeepSeek、MiniMax、GLM 快捷入口，也支持自定义兼容接口。', 2900);
    await tour.click('[data-provider-add="DeepSeek"]');
    await tour.read('选择 DeepSeek 后，服务地址和模型已填好。使用自己的密钥后再保存或测试连接。', 2400);
    await tour.click(aria('深色模式'));
    await tour.read('左下角可以切换深色或跟随系统，保持自己习惯的外观。', 2200);
  }],
];

let sequence = 0;
let current;
let observer;
const cancelled = Symbol('tour cancelled');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeTour(session) {
  const check = () => {
    if (current !== session) throw cancelled;
  };
  async function wait(ms) {
    for (let remaining = ms; remaining > 0;) {
      check();
      if (session.paused) {
        await delay(60);
        continue;
      }
      const slice = Math.min(remaining, 60);
      await delay(slice);
      if (!session.paused) remaining -= slice;
    }
    check();
    while (session.paused) { await delay(60); check(); }
  }
  async function find(target, attempts = 120) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      check();
      const doc = app.contentDocument;
      if (doc && new URL(doc.URL).searchParams.get('run') === String(session.id)) {
        const node = typeof target === 'function' ? target(doc) : doc.querySelector(target);
        if (node?.getClientRects().length && !node.disabled) return node;
      }
      await wait(80);
    }
    throw Error('Tour target unavailable: ' + target);
  }
  async function click(target) {
    const node = await find(target);
    node.scrollIntoView({block: 'nearest'});
    const rect = node.getBoundingClientRect();
    const view = node.ownerDocument.defaultView;
    pointer.style.left = 100 * (rect.x + rect.width / 2) / view.innerWidth + '%';
    pointer.style.top = 100 * (rect.y + rect.height / 2) / view.innerHeight + '%';
    pointer.hidden = false;
    await wait(970);
    pointer.classList.add('clicking');
    node.click();
    await wait(430);
    pointer.classList.remove('clicking');
  }
  async function type(target, text, interval, group = 1) {
    await click(target);
    const node = await find(target);
    const view = node.ownerDocument.defaultView;
    const prototype = node.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    node.focus({preventScroll: true});
    for (let length = 0; length < text.length; length += group) {
      check();
      set.call(node, text.slice(0, length + group));
      node.dispatchEvent(new view.Event('input', {bubbles: true}));
      await wait(interval);
    }
  }
  return {
    click, type, find,
    async reveal(target, block) { (await find(target)).scrollIntoView({block}); await wait(350); },
    async read(text, ms) { description.textContent = text; await wait(ms); },
  };
}

function showChapter(index) {
  const [label, title] = chapters[index];
  badge.textContent = numbered(index + 1) + ' / ' + numbered(chapters.length);
  name.textContent = title;
  description.textContent = '打开「' + label + '」演示。';
  progress.style.width = 100 * index / chapters.length + '%';
  for (const [position, item] of [...nav.children].entries()) {
    if (position === index) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
}

async function start(index) {
  observer?.disconnect();
  const session = {id: ++sequence, paused: false};
  current = session;
  const tour = makeTour(session);
  showChapter(index);
  stage.classList.remove('is-ready');
  pointer.hidden = true;
  pointer.classList.remove('clicking');
  pointer.style.left = '16%';
  pointer.style.top = '30%';
  play.textContent = 'Ⅱ 暂停';
  play.hidden = false;
  app.src = './app/?chapter=' + index + '&run=' + session.id;
  try {
    await tour.find('.dashboard-page', 260);
    stage.classList.add('is-ready');
    for (let i = index; i < chapters.length; i++) {
      showChapter(i);
      await chapters[i][2](tour);
    }
    progress.style.width = '100%';
    play.hidden = true;
    description.textContent = '演示结束。可以点下方章节重看，或下载 App 体验自己的课表和资料。';
  } catch (error) {
    if (error === cancelled || current !== session) return;
    console.error(error);
    stage.classList.remove('is-ready');
    description.textContent = '这一段暂时没有加载成功。可以重试，或选择其他章节。';
    play.textContent = '▶ 播放完整演示';
  } finally {
    if (current === session) {
      current = undefined;
      pointer.hidden = true;
      pointer.classList.remove('clicking');
    }
  }
}

chapters.forEach(([label], index) => {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = numbered(index + 1) + ' ' + label;
  item.addEventListener('click', () => void start(index));
  nav.append(item);
});
play.addEventListener('click', () => {
  if (!current) return void start(0);
  current.paused = !current.paused;
  play.textContent = current.paused ? '▶ 继续播放' : 'Ⅱ 暂停';
});
const resize = () => stage.style.setProperty('--tour-scale', String(stage.clientWidth / 1360));
resize();
new ResizeObserver(resize).observe(stage);
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) void start(0);
  }, {threshold: 0.42});
  observer.observe(stage);
}
