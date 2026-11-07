const views = {
  home: ['assets/screenshots/home-light.png', '从接下来的一件事开始', '打开首页，未来七天的课程与待办就排在同一条日程里。'],
  timetable: ['assets/screenshots/timetable-light.png', '把课表带进工作台', '导入或手动录入课程，按周查看时间和地点，点一下课程就能新建课堂笔记。'],
  todo: ['assets/screenshots/todo-light.png', '把作业截止时间记下来', '用便利贴记待办，给作业、组会或论文阅读设定时提醒。'],
  notes: ['notes-light.png', '按课程整理课堂笔记', '用笔记本收纳课堂笔记、阅读记录和随手备忘。'],
  files: ['assets/screenshots/local-files-light.png', '课程资料就在手边', '添加已有的本地文件夹，在工作台里浏览目录、阅读 Markdown。'],
  ai: ['assets/screenshots/ai-actions.png', '说一句话，就能建待办', '接入模型后，可以让 AI 查课表、建待办或保存笔记，创建的记录可查看、编辑和撤销。'],
};

const buttons = document.querySelectorAll('[data-view]');
const shot = document.querySelector('#shot');
const shotLink = document.querySelector('#shot-link');
const captionTitle = document.querySelector('#caption-title');
const captionBody = document.querySelector('#caption-body');

for (const button of buttons) {
  button.addEventListener('click', () => {
    const [path, title, description] = views[button.dataset.view];
    for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
    shot.alt = 'NEU-Dela 应用截图：' + title;
    shot.src = path;
    shotLink.href = path;
    captionTitle.textContent = title;
    captionBody.textContent = description;
  });
}
