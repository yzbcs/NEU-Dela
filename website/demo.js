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
const pointer = document.querySelector('#demo-pointer');
const typing = document.querySelector('#demo-typing');
let playback;
let hasStarted = false;
let observer;

function showFrame(name, path, description) {
  previewImage.src = path;
  previewImage.alt = 'NEU-Dela 桌面应用截图：' + name;
  previewFull.href = path;
  previewName.textContent = name;
  previewDescription.textContent = description;
  previewImage.classList.remove('preview-enter');
  requestAnimationFrame(() => previewImage.classList.add('preview-enter'));
}

function showPreview(index) {
  showFrame(...previews[index]);
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
}

function stopPreview() {
  hasStarted = true;
  observer?.disconnect();
  playback = undefined;
  pointer.hidden = true;
  pointer.classList.remove('clicking');
  typing.hidden = true;
  typing.textContent = '';
  previewPlay.textContent = '▶ 播放操作演示';
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
const operationFrames = [
  ['工作台首页', 'demo-home.png', '先从首页右侧找到「首页链接的待办」。'],
  ['完成待办', 'demo-todo-done.png', '勾选后，待办标为完成，未完成的数量从 2 变成 1。'],
  ['AI 助手', 'demo-ai-ready.png', '打开 AI 助手，在输入框写下要办的事。'],
  ['AI 执行结果', 'demo-ai-result.png', 'AI 将示例课程、待办与笔记写入工作台，并展示操作结果。'],
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function animateOperations() {
  if (playback) return;
  hasStarted = true;
  observer?.disconnect();
  const run = Symbol();
  playback = run;
  previewPlay.textContent = '■ 停止演示';
  previewPlay.setAttribute('aria-pressed', 'true');
  previewHotspots.replaceChildren();
  for (const button of previewNav.children) button.setAttribute('aria-pressed', 'false');

  async function clickAt(x, y) {
    pointer.style.left = x + '%';
    pointer.style.top = y + '%';
    await wait(600);
    if (playback !== run) return false;
    pointer.classList.add('clicking');
    await wait(280);
    if (playback !== run) return false;
    pointer.classList.remove('clicking');
    return true;
  }

  showFrame(...operationFrames[0]);
  pointer.style.left = '60%';
  pointer.style.top = '43%';
  pointer.hidden = false;
  await wait(850);
  if (playback !== run || !await clickAt(71.8, 61.1)) return;
  showFrame(...operationFrames[1]);
  await wait(1500);
  if (playback !== run || !await clickAt(6.8, 29.8)) return;
  showFrame(...operationFrames[2]);
  await wait(650);
  if (playback !== run || !await clickAt(32, 82.3)) return;
  typing.hidden = false;
  for (const character of '请帮我添加示例课程、待办和笔记。') {
    if (playback !== run) return;
    typing.textContent += character;
    await wait(62);
  }
  await wait(550);
  if (playback !== run || !await clickAt(86.4, 91.7)) return;
  typing.hidden = true;
  typing.textContent = '';
  showFrame(...operationFrames[3]);
  await wait(2500);
  if (playback !== run) return;
  stopPreview();
  previewPlay.textContent = '↻ 重播操作演示';
}

previewPlay.addEventListener('click', () => {
  if (playback) {
    stopPreview();
    showPreview(0);
  } else {
    animateOperations();
  }
});
showPreview(0);
for (const [, path] of operationFrames) {
  const image = new Image();
  image.src = path;
}
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  observer = new IntersectionObserver(entries => {
    if (!hasStarted && entries.some(entry => entry.isIntersecting)) animateOperations();
  }, {threshold: 0.45});
  observer.observe(document.querySelector('.preview-frame'));
}
