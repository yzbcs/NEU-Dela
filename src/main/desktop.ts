import { app, dialog, Notification, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import type { TimetableImport, WorkspaceApi } from '../shared/workspace';
import { WorkspaceService } from './workspace';
import { MailService } from './mail';
import { timetableIcs } from './timetable';
import { readTimetableFile } from './timetable-file';
import { openWebTimetableImport } from './web-timetable-window';
import { LocalFiles } from './local-files';
import { ChatAttachments } from './chat-attachments';
import { studentProfiles } from '../shared/student-profile';

export function desktopApi(
  store: Store,
  changed: () => void,
  getWindow: () => BrowserWindow,
  showWindow: () => void,
) {
  const openTodo = (id: string) => {
    showWindow();
    getWindow().webContents.send('dola:open-todo', id);
  };
  const notify = (title: string, body: string, todoId?: string) => {
    if (!Notification.isSupported()) throw new Error('当前系统不支持桌面通知');
    const notification = new Notification({ title, body });
    notification.on('click', () => (todoId ? openTodo(todoId) : showWindow()));
    notification.show();
  };
  const service = new WorkspaceService(store, changed, (todo) =>
    notify(
      'NEU Dot · ' + todo.title,
      todo.detail || '到时间了，打开工作台查看这条便利贴。',
      todo.id,
    ),
  );
  const mail = new MailService(store, changed);
  const localFiles = new LocalFiles(store);
  const chatAttachments = new ChatAttachments(store);
  const id = (value: string) => z.string().uuid().parse(value);
  const url = (value: string) => {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol))
      throw new Error('请输入 HTTP/HTTPS 网站地址');
    return parsed.href;
  };
  const api: WorkspaceApi = {
    async saveTodo(input) {
      service.saveTodo(input);
    },
    async toggleTodo(value) {
      service.toggleTodo(id(value));
    },
    async undoTodo(value, previous) {
      service.undoTodo(id(value), previous);
    },
    async removeTodo(value) {
      service.removeTodo(id(value));
    },
    async testNotification() {
      notify('NEU Dot 提醒测试', '如果看到了这条通知，便利贴提醒已可以显示。');
    },
    async importTimetable() {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: '导入学校导出的课表',
        properties: ['openFile'],
        filters: [
          {
            name: '课表文件（PDF、Excel、Word）',
            extensions: ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'do'],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const original = result.filePaths[0];
      const directory = join(store.dataDirectory, 'timetables');
      mkdirSync(directory, { recursive: true });
      const destination = join(directory, randomUUID() + extname(original).toLowerCase());
      copyFileSync(original, destination);
      let draft: TimetableImport;
      try {
        draft = await readTimetableFile(destination, store.workspace.degree);
      } catch (error) {
        draft = {
          sourcePath: destination,
          sourceName: basename(original),
          courses: [],
          text: '',
          warnings: [],
          recognitionError: error instanceof Error ? error.message : String(error),
        };
      }
      draft.sourceName = basename(original);
      if (!draft.courses.length) {
        draft.recognitionError ||= draft.warnings[0] || '未能识别出课程，请核对原始文件。';
        try {
          if (extname(destination) === '.pdf')
            draft.aiAttachment = await chatAttachments.addFile(destination, basename(original));
          else if (draft.text.trim()) {
            const structuredPath = destination + '.json';
            writeFileSync(structuredPath, draft.text);
            draft.aiAttachment = await chatAttachments.addFile(
              structuredPath,
              basename(original) + '（课表结构）.json',
            );
          }
        } catch (error) {
          draft.recognitionError +=
            ' 引用文件准备失败，' + (error instanceof Error ? error.message : String(error));
        }
      }
      return draft;
    },
    async importWebTimetable() {
      if (!store.workspace.degreeConfirmed) throw new Error('请先选择本科生或研究生身份。');
      const degree = store.workspace.degree;
      const draft = await openWebTimetableImport(degree, store.dataDirectory, showWindow);
      if (draft?.recognitionError)
        draft.aiAttachment = await chatAttachments.addFile(
          join(store.dataDirectory, 'timetables', degree + '-webpage.json'),
          studentProfiles[degree].label + '课表页面.json',
        );
      return draft;
    },
    async saveTimetable(input) {
      service.saveTimetable(input);
    },
    async updateTimetableSettings(input) {
      service.updateTimetableSettings(input);
    },
    async exportTimetable() {
      const table = store.workspace.timetable;
      if (!table.firstMonday || !table.courses.length) throw new Error('请先保存有课程的课表');
      const result = await dialog.showSaveDialog(getWindow(), {
        title: '导出到系统日历',
        defaultPath: 'NEU-课表.ics',
        filters: [{ name: '日历文件', extensions: ['ics'] }],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, timetableIcs(table));
      return result.filePath;
    },
    async saveNote(input) {
      return service.saveNote(input);
    },
    async saveNotebook(name, previousName) {
      service.saveNotebook(name, previousName);
    },
    async removeNotebook(name) {
      service.removeNotebook(name);
    },
    async removeNote(value) {
      service.removeNote(id(value));
    },
    async exportNote(value) {
      const note = store.workspace.notes.find((item) => item.id === id(value));
      if (!note) throw new Error('笔记不存在');
      const result = await dialog.showSaveDialog(getWindow(), {
        defaultPath: note.title.replace(/[<>:"/\\|?*]/g, '_') + '.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, '# ' + note.title + '\n\n' + note.body);
      return result.filePath;
    },
    async addResources(kind, category) {
      if (!['file', 'folder'].includes(kind)) throw new Error('资料类型无效');
      const result = await dialog.showOpenDialog(getWindow(), {
        title: kind === 'folder' ? '添加本地资料文件夹' : '添加本地资料文件',
        properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      });
      if (result.canceled) return;
      for (const path of result.filePaths)
        if (!store.workspace.resources.some((item) => item.path === path))
          store.workspace.resources.unshift({
            id: randomUUID(),
            title: basename(path),
            kind,
            path,
            category,
            addedAt: new Date().toISOString(),
          });
      service.save();
    },
    async addLink(title, path, category) {
      store.workspace.resources.unshift({
        id: randomUUID(),
        title: title.trim() || new URL(path).hostname,
        path: url(path),
        kind: 'link',
        category,
        addedAt: new Date().toISOString(),
      });
      service.save();
    },
    async removeResource(value) {
      store.workspace.resources = store.workspace.resources.filter((item) => item.id !== id(value));
      service.save();
    },
    async openResource(value) {
      const item = store.workspace.resources.find((item) => item.id === id(value));
      if (!item) throw new Error('资料不存在');
      if (item.kind === 'link') await shell.openExternal(url(item.path));
      else {
        const error = await shell.openPath(item.path);
        if (error) throw new Error('文件可能已移动或删除：' + error);
      }
    },
    async openLocal(path) {
      const error = await shell.openPath(z.string().min(1).parse(path));
      if (error) throw new Error(error);
    },
    async listResourceDirectory(value, path, offset = 0) {
      return localFiles.list(
        id(value),
        z.string().parse(path),
        z.number().int().nonnegative().parse(offset),
      );
    },
    async readResourceFile(value, path) {
      return localFiles.read(id(value), z.string().parse(path));
    },
    async readResourceImage(value, path, source) {
      return localFiles.image(id(value), z.string().parse(path), z.string().parse(source));
    },
    async resolveResourceLink(value, path, href) {
      return localFiles.link(id(value), z.string().parse(path), z.string().parse(href));
    },
    async openResourcePath(value, path, reveal = false) {
      const target = await localFiles.getPath(id(value), z.string().parse(path));
      if (reveal) shell.showItemInFolder(target);
      else {
        const error = await shell.openPath(target);
        if (error) throw new Error(error);
      }
    },
    async openWebsite(value) {
      await shell.openExternal(url(value));
    },
    async setDegree(value) {
      service.setDegree(value);
    },
    async saveMailAccount(input) {
      return mail.save(input);
    },
    async removeMailAccount(value) {
      mail.remove(id(value));
    },
    async testMailAccount(value) {
      return mail.test(id(value));
    },
    async testMailConnection(input) {
      return mail.testConnection(input);
    },
    async mailFolders(value) {
      return mail.folders(id(value));
    },
    async mailList(value, folder, page) {
      return mail.list(
        id(value),
        z.string().min(1).parse(folder),
        z.number().int().min(1).parse(page),
      );
    },
    async mailCached(value, folder) {
      return mail.cached(id(value), z.string().min(1).parse(folder));
    },
    async mailRead(value, folder, uid, validity) {
      return mail.read(
        id(value),
        z.string().min(1).parse(folder),
        z.number().int().positive().parse(uid),
        z.string().min(1).parse(validity),
      );
    },
    async mailAttachment(value, folder, uid, validity, index) {
      const attachment = await mail.attachment(
        id(value),
        z.string().min(1).parse(folder),
        z.number().int().positive().parse(uid),
        z.string().min(1).parse(validity),
        z.number().int().nonnegative().parse(index),
      );
      const result = await dialog.showSaveDialog(getWindow(), {
        defaultPath: basename(attachment.filename ?? '附件'),
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, attachment.content);
      return result.filePath;
    },
    async mailSend(draft) {
      return mail.send(draft);
    },
    async getDiagnostics() {
      const path = join(store.dataDirectory, 'logs', 'dola.log');
      return existsSync(path) ? store.redact(readFileSync(path, 'utf8')) : '暂无错误日志。';
    },
    async showDataFolder() {
      const error = await shell.openPath(store.dataDirectory);
      if (error) throw new Error(error);
    },
    async getAppInfo() {
      return { version: app.getVersion(), dataDirectory: store.dataDirectory };
    },
  };
  return { api, service };
}
