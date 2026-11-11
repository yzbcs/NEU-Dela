import {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  nativeTheme,
  type IpcMainEvent,
} from 'electron';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureCoursePage, parseWebTimetable, type CoursePage } from './web-timetable';
import type { TimetableImport } from '../shared/workspace';
import themeCss from '../shared/theme.css?raw';
import { isTimetablePage, studentProfiles, type Degree } from '../shared/student-profile';

const toolbar = (
  label: string,
  systemName: string,
) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${label}课表导入 · NEU Dot</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>${themeCss}*{box-sizing:border-box}body{margin:0;background:var(--page);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:var(--text)}.toolbar{height:116px;padding:16px 22px;border-bottom:1px solid var(--border)}.row{display:flex;align-items:center;gap:10px}strong{font-size:16px;margin-right:auto;color:var(--text-strong)}button{font:inherit;border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);padding:8px 14px;border-radius:9px;cursor:pointer}button.primary{background:var(--accent-fill);color:var(--on-accent);border-color:var(--accent-fill)}button:disabled{opacity:.5}p{margin:9px 0 0;font-size:12px;color:var(--text-muted)}#status{color:var(--accent)}</style></head>
<body><div class="toolbar"><div class="row"><strong>${label}课表导入</strong><button id="back">返回</button><button id="reload">刷新</button><button id="read" class="primary">读取当前课表</button></div>
<p>请登录${systemName}，进入个人课表并选择全学期后读取。若“选择身份”为空，请回到设置核对学生类型。登录状态仅保留在本机。</p><p id="status" role="status">正在打开${systemName}；NEU Dot 不读取密码输入框。</p></div>
<script>const api=window.timetableImport;const read=document.getElementById('read');document.getElementById('back').onclick=()=>api.back();document.getElementById('reload').onclick=()=>api.reload();read.onclick=()=>{read.disabled=true;api.read()};api.onStatus(message=>{document.getElementById('status').textContent=message;read.disabled=false});</script></body></html>`;

export function openWebTimetableImport(
  degree: Degree,
  dataDirectory: string,
  showMain: () => void,
): Promise<TimetableImport | null> {
  const profile = studentProfiles[degree];
  // Keep the existing graduate login; the undergraduate system gets its own session.
  const partition = 'persist:neu-' + degree;
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      width: 1240,
      height: 880,
      minWidth: 980,
      minHeight: 680,
      title: profile.label + '课表导入 · NEU Dot',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#161d27' : '#edf0f3',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/timetable.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const popups = new Set<BrowserWindow>();
    let result: TimetableImport | null = null;
    let reading = false;
    window.contentView.addChildView(view);
    const resize = () => {
      const [width, height] = window.getContentSize();
      view.setBounds({ x: 0, y: 116, width, height: Math.max(0, height - 116) });
    };
    resize();
    window.on('resize', resize);
    const status = (message: string) => {
      if (!window.isDestroyed()) window.webContents.send('dola:timetable:status', message);
    };
    const trackPopups = (contents: Electron.WebContents) => {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url) || url === 'about:blank')
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              webPreferences: {
                partition,
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
              },
            },
          };
        return { action: 'deny' };
      });
      contents.on('did-create-window', (popup) => {
        popups.add(popup);
        popup.on('closed', () => popups.delete(popup));
        trackPopups(popup.webContents);
        status('系统打开了新窗口；显示课表后，请回到这个窗口点击“读取当前课表”。');
      });
      contents.on('will-navigate', (event, url) => {
        if (!/^https?:\/\//.test(url)) {
          event.preventDefault();
          if (/^mailto:/.test(url)) void shell.openExternal(url);
        }
      });
    };
    trackPopups(view.webContents);
    view.webContents.on('did-finish-load', () =>
      status('当前入口：' + profile.systemName + '。请进入个人课表，确认学期及显示范围后读取。'),
    );
    view.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3)
        status('学校页面加载失败（' + description + '）。请检查校园网或 VPN 后刷新。');
    });
    const read = async (event: IpcMainEvent) => {
      if (event.sender !== window.webContents || reading) return;
      reading = true;
      status('正在读取学校页面中的课表');
      try {
        const pages: CoursePage[] = [];
        const contents = [...popups]
          .filter((popup) => !popup.isDestroyed())
          .map((popup) => popup.webContents)
          .reverse();
        contents.push(view.webContents);
        for (const page of contents)
          for (const frame of page.mainFrame.framesInSubtree) {
            if (frame.detached) continue;
            if (!isTimetablePage(frame.url, degree)) continue;
            const snapshot = (await frame.executeJavaScript(
              '(' + captureCoursePage.toString() + ')()',
            )) as CoursePage | null;
            if (snapshot) pages.push(snapshot);
          }
        if (!pages.length)
          throw new Error(
            '请先登录' +
              profile.systemName +
              '并进入个人课表；若身份列表为空，请在设置中核对学生类型。',
          );
        const directory = join(dataDirectory, 'timetables');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, degree + '-webpage.json'), JSON.stringify(pages, null, 2));
        try {
          result = parseWebTimetable(pages, degree);
        } catch (error) {
          if (
            !pages.some(
              (page) => page.cards?.length || page.tables.some((table) => table.rows.length),
            )
          )
            throw error;
          result = {
            sourcePath: '',
            sourceName: profile.sourceName,
            sourceUrl: pages[0].url,
            courses: [],
            text: JSON.stringify(pages, null, 2),
            warnings: [],
            recognitionError: error instanceof Error ? error.message : String(error),
          };
        }
        window.close();
        showMain();
      } catch (error) {
        status(error instanceof Error ? error.message : String(error));
      } finally {
        reading = false;
      }
    };
    const back = (event: IpcMainEvent) => {
      if (event.sender === window.webContents && view.webContents.navigationHistory.canGoBack())
        view.webContents.navigationHistory.goBack();
    };
    const reload = (event: IpcMainEvent) => {
      if (event.sender === window.webContents) view.webContents.reload();
    };
    ipcMain.on('dola:timetable:read', read);
    ipcMain.on('dola:timetable:back', back);
    ipcMain.on('dola:timetable:reload', reload);
    window.on('closed', () => {
      ipcMain.removeListener('dola:timetable:read', read);
      ipcMain.removeListener('dola:timetable:back', back);
      ipcMain.removeListener('dola:timetable:reload', reload);
      for (const popup of popups) popup.destroy();
      if (!view.webContents.isDestroyed()) view.webContents.close();
      resolve(result);
    });
    void window
      .loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(toolbar(profile.label, profile.systemName)),
      )
      .then(() => view.webContents.loadURL(profile.portal))
      .catch((error) => status('页面打开失败，请检查网络后点击刷新：' + error.message));
  });
}
