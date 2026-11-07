const panel = document.querySelector('#panel');
const nav = document.querySelector('#demo-nav');
const play = document.querySelector('#play');
const status = document.querySelector('#demo-status');
const help = status.textContent;
const pages = [
  ['工作台', '先看看接下来的课和待办。'],
  ['课表', '展开课程详情，也可以切换周次。'],
  ['待办', '勾选完成，或添加一条待办。'],
  ['笔记', '编辑笔记，切换页面后仍会保留。'],
  ['本地资料', '打开文件预览示例资料。'],
  ['AI 助手', '试一句指令，让 AI 创建示例待办。'],
];
const lessons = [
  [['周一 08:30', '机器学习', '信息学馆 A204'], ['周三 14:00', '自然语言处理', '教学楼 B302']],
  [['周二 10:00', '机器学习习题课', '信息学馆 A204'], ['周四 14:00', '计算机网络', '教学楼 B302']],
];

let state;
let view = 0;
let timer;
function reset() {
  state = {week: 0, tasks: [{title: '整理机器学习课堂笔记', done: false}, {title: '提交课程实验报告', done: false}], note: '为什么训练误差更小，预测却不一定更好？\n\n下次课前：比较训练误差和验证误差，补一个正则化的例子。', ai: false};
}
const content = [
  () => '<div class="demo-grid"><button data-go="1"><small>下一节课</small><strong>机器学习 · 周一 08:30</strong></button><button data-go="2"><small>待办事项</small><strong>' + state.tasks.filter(task => !task.done).length + ' 项未完成</strong></button><button data-go="3"><small>最近笔记</small><strong>机器学习 · 正则化</strong></button></div>',
  () => '<p>第 ' + (9 + state.week) + ' 周</p>' + lessons[state.week].map(([time, title, room]) => '<details><summary>' + time + ' · ' + title + '</summary><p>浑南校区 · ' + room + '</p></details>').join('') + '<button id="week">' + (state.week ? '← 上一周' : '下一周 →') + '</button>',
  () => '<div id="tasks"></div><form id="task-form"><input name="title" aria-label="新待办" placeholder="比如：明天交实验报告" maxlength="80" required><button type="submit">添加</button></form>',
  () => '<label for="note">机器学习 / 正则化：让模型记住规律</label><textarea id="note" rows="6" maxlength="2000"></textarea>',
  () => '<details><summary>机器学习 / 课程笔记.md</summary><p>比较训练误差与验证误差，理解正则化怎样改善泛化。</p></details><details><summary>组会 / 论文阅读提纲.md</summary><p>记录论文要解决的问题，再整理方法、关键实验和疑问。</p></details>',
  () => '<button id="ask"' + (state.ai ? ' disabled' : '') + '>帮我设个明晚八点读论文的提醒</button>' + (state.ai ? '<p class="demo-result">已创建示例待办：明晚 20:00 读论文。</p><button data-go="2">查看待办 →</button>' : ''),
];

nav.innerHTML = pages.map(([name], index) => '<button type="button" data-go="' + index + '">' + name + '</button>').join('');
function render(next) {
  view = next;
  for (const button of nav.children) button.setAttribute('aria-pressed', String(Number(button.dataset.go) === view));
  panel.innerHTML = '<div class="demo-scene"><h3 tabindex="-1">' + pages[view][0] + '</h3><p>' + pages[view][1] + '</p>' + content[view]() + '</div>';
  if (view === 3) panel.querySelector('#note').value = state.note;
  if (view === 2) {
    const list = panel.querySelector('#tasks');
    state.tasks.forEach(task => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      const name = document.createElement('span');
      checkbox.type = 'checkbox';
      checkbox.checked = task.done;
      checkbox.addEventListener('change', () => { task.done = checkbox.checked; });
      name.textContent = task.title;
      label.append(checkbox, name);
      list.append(label);
    });
  }
}
function stop(message = help) {
  clearInterval(timer);
  timer = undefined;
  play.textContent = '▶ 播放功能演示';
  play.setAttribute('aria-pressed', 'false');
  status.textContent = message;
}
document.querySelector('.workbench').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.go !== undefined) {
    stop();
    render(Number(button.dataset.go));
    if (panel.contains(event.target) || !nav.contains(button)) panel.querySelector('h3').focus();
  } else if (button?.id === 'week') {
    state.week = 1 - state.week;
    render(view);
    panel.querySelector('#week').focus();
  } else if (button?.id === 'ask' && !state.ai) {
    state.ai = true;
    state.tasks.push({title: '明晚 20:00 读论文', done: false});
    render(view);
    status.textContent = '已创建一条示例待办。';
    panel.querySelector('[data-go]').focus();
  }
});
panel.addEventListener('focusin', () => { if (timer) stop(); });
panel.addEventListener('pointerdown', () => { if (timer) stop(); });
panel.addEventListener('input', event => {
  if (event.target.id === 'note') state.note = event.target.value;
});
panel.addEventListener('submit', event => {
  event.preventDefault();
  const title = new FormData(event.target).get('title').trim();
  if (!title) return;
  state.tasks.push({title, done: false});
  render(2);
  panel.querySelector('#task-form input').focus();
  status.textContent = '已添加一条示例待办。';
});
play.addEventListener('click', () => {
  if (timer) return stop('已暂停，可以继续手动体验。');
  let index = 0;
  const advance = () => {
    if (index === pages.length) return stop('演示结束，可以继续手动体验。');
    render(index);
    status.textContent = (index + 1) + '/' + pages.length + ' · ' + pages[index][1];
    index++;
  };
  play.textContent = 'Ⅱ 暂停演示';
  play.setAttribute('aria-pressed', 'true');
  advance();
  timer = setInterval(advance, 3900);
});
document.querySelector('#reset').addEventListener('click', () => {
  stop('已恢复示例数据。');
  reset();
  render(0);
});
reset();
render(0);

// Positions are percentages of the original desktop screenshots.
const previews = [
  ['工作台首页', 'assets/screenshots/home-light.png', '首页把接下来的课程、未来七天安排和待办放在一起。'],
  ['我的课表', 'assets/screenshots/timetable-light.png', '按周查看课程时间、地点和节次。'],
  ['今日便利贴', 'assets/screenshots/todo-light.png', '查看待完成与已完成的便利贴。'],
  ['资料与笔记', 'notes-light.png', '在笔记列表和编辑区之间切换，按课程归类。'],
  ['本地资料', 'assets/screenshots/local-files-light.png', '从目录打开文件，在右侧预览内容。'],
  ['AI 助手', 'assets/screenshots/ai-actions.png', '查看 AI 创建的课程和笔记卡片。'],
];
const sidebar = [[0, 26], [5, 30.2], [2, 34.5], [1, 38.8], [3, 47.2]];
const previewNav = document.querySelector('#preview-nav');
const previewHotspots = document.querySelector('#preview-hotspots');
const previewImage = document.querySelector('#app-shot');
const previewName = document.querySelector('#preview-name');
const previewDescription = document.querySelector('#preview-description');
const previewFull = document.querySelector('#preview-full');
const previewPlay = document.querySelector('#preview-play');
let previewIndex = 0;
let previewTimer;

function showPreview(index) {
  previewIndex = index;
  const [name, path, description] = previews[index];
  previewImage.src = path;
  previewImage.alt = 'NEU-Dela 桌面应用截图：' + name;
  previewFull.href = path;
  previewName.textContent = name;
  previewDescription.textContent = description;
  for (const button of previewNav.children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.preview) === index));
  }
  const homeLinks = [[1, 88.5, 22, 7.5, 5], [2, 69.8, 43.5, 27.7, 25]];
  const libraryLinks = [[3, 19.4, index === 4 ? 12.4 : 18.2, 5.5, 4.8], [4, 25.7, index === 4 ? 12.4 : 18.2, 5.5, 4.8]];
  const hotspots = sidebar.map(([target, top]) => [target, 1.4, top - ([2, 4, 5].includes(index) ? 2.2 : 0), 14.3, 4.1]);
  if (index === 0) hotspots.push(...homeLinks);
  if (index === 3 || index === 4) hotspots.push(...libraryLinks);
  previewHotspots.innerHTML = hotspots.map(([target, x, y, w, h]) =>
    '<button type="button" data-preview="' + target + '" aria-label="' + previews[target][0] + '" title="' + previews[target][0] + '" style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%"></button>'
  ).join('');
  previewImage.classList.remove('preview-enter');
  requestAnimationFrame(() => previewImage.classList.add('preview-enter'));
}

function stopPreview() {
  clearInterval(previewTimer);
  previewTimer = undefined;
  previewPlay.textContent = '▶ 播放界面导览';
  previewPlay.setAttribute('aria-pressed', 'false');
}

previewNav.innerHTML = previews.map(([name], index) => '<button type="button" data-preview="' + index + '">' + name + '</button>').join('');
for (const container of [previewNav, previewHotspots]) {
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-preview]');
    if (!button) return;
    stopPreview();
    const next = Number(button.dataset.preview);
    showPreview(next);
    if (container === previewHotspots) previewNav.children[next].focus({preventScroll: true});
  });
}
previewPlay.addEventListener('click', () => {
  if (previewTimer) return stopPreview();
  showPreview(0);
  previewPlay.textContent = 'Ⅱ 暂停界面导览';
  previewPlay.setAttribute('aria-pressed', 'true');
  previewTimer = setInterval(() => {
    if (previewIndex === previews.length - 1) return stopPreview();
    showPreview(previewIndex + 1);
  }, 3200);
});
document.querySelector('.sandbox-demo').addEventListener('toggle', event => {
  if (event.target.open) stopPreview();
  else stop();
});
showPreview(0);
