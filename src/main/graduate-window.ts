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

export const graduatePortal = 'https://yjs.neu.edu.cn/gsapp/sys/yjsemaphome/portal/index.do';
const toolbar = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>研究生课表导入 · NEU-Dela</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>${themeCss}*{box-sizing:border-box}body{margin:0;background:var(--page);font:14px -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:var(--text)}.toolbar{height:116px;padding:16px 22px;border-bottom:1px solid var(--border)}.row{display:flex;align-items:center;gap:10px}strong{font-size:16px;margin-right:auto;color:var(--text-strong)}button{font:inherit;border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);padding:8px 14px;border-radius:9px;cursor:pointer}button.primary{background:var(--accent-fill);color:var(--on-accent);border-color:var(--accent-fill)}button:disabled{opacity:.5}p{margin:9px 0 0;font-size:12px;color:var(--text-muted)}#status{color:var(--accent)}</style></head>
<body><div class="toolbar"><div class="row"><strong>研究生课表导入</strong><button id="back">返回</button><button id="reload">刷新</button><button id="read" class="primary">读取当前课表</button></div>
<p>请在学校页面自行登录，进入个人课表并选择全学期，再点击右上角读取。登录状态仅保留在本机。</p><p id="status" role="status">正在打开研究生系统；NEU-Dela 不读取密码输入框。</p></div>
<script>const api=window.graduateImport;const read=document.getElementById('read');document.getElementById('back').onclick=()=>api.back();document.getElementById('reload').onclick=()=>api.reload();read.onclick=()=>{read.disabled=true;api.read()};api.onStatus(message=>{document.getElementById('status').textContent=message;read.disabled=false});</script></body></html>`;

export function openGraduateImport(
  dataDirectory: string,
  showMain: () => void,
): Promise<TimetableImport | null> {
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      width: 1240,
      height: 880,
      minWidth: 980,
      minHeight: 680,
      title: '研究生课表导入 · NEU-Dela',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#161d27' : '#edf0f3',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/graduate.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:neu-graduate',
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
      if (!window.isDestroyed()) window.webContents.send('dola:graduate:status', message);
    };
    const trackPopups = (contents: Electron.WebContents) => {
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url) || url === 'about:blank')
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              webPreferences: {
                partition: 'persist:neu-graduate',
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
      status('请进入个人课表，确认所选学期及显示范围后读取。'),
    );
    const read = async (event: IpcMainEvent) => {
      if (event.sender !== window.webContents || reading) return;
      reading = true;
      status('正在读取学校页面中的课程表格');
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
            let host: string;
            try {
              host = new URL(frame.url).hostname;
            } catch {
              continue;
            }
            if (host !== 'yjs.neu.edu.cn') continue;
            const snapshot = (await frame.executeJavaScript(
              '(' + captureCoursePage.toString() + ')()',
            )) as CoursePage | null;
            if (snapshot) pages.push(snapshot);
          }
        if (!pages.length) throw new Error('请先在学校统一身份认证页面完成登录，再进入个人课表。');
        const directory = join(dataDirectory, 'timetables');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'graduate-webpage.json'), JSON.stringify(pages, null, 2));
        result = parseWebTimetable(pages);
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
    ipcMain.on('dola:graduate:read', read);
    ipcMain.on('dola:graduate:back', back);
    ipcMain.on('dola:graduate:reload', reload);
    window.on('closed', () => {
      ipcMain.removeListener('dola:graduate:read', read);
      ipcMain.removeListener('dola:graduate:back', back);
      ipcMain.removeListener('dola:graduate:reload', reload);
      for (const popup of popups) popup.destroy();
      if (!view.webContents.isDestroyed()) view.webContents.close();
      resolve(result);
    });
    void window
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toolbar))
      .then(() => view.webContents.loadURL(graduatePortal))
      .catch((error) => status('页面打开失败，请检查网络后点击刷新：' + error.message));
  });
}
