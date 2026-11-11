import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  Menu,
  Tray,
  nativeImage,
  powerMonitor,
  nativeTheme,
  dialog,
  Notification,
} from 'electron';
import { basename, join } from 'node:path';
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import electronUpdater, { type AppUpdater } from 'electron-updater';
import { z } from 'zod';
import { Store } from './store';
import { ChatService } from './chat';
import { providerConnectionInput, providerInput } from '../shared/validation';
import { desktopApi } from './desktop';
import { UpdateService } from './updater';
import { MacZipUpdater, prepareMacInstall, acknowledgeMacInstall } from './mac-update';

const isolatedData = process.env.DOLA_DATA_DIR;
// Keep the existing profile and macOS Keychain identity across the display-name change.
app.setPath('userData', isolatedData || join(app.getPath('appData'), 'NEU Dola'));
app.setName('NEU Dola');
if (!app.requestSingleInstanceLock()) app.exit(0);
if (process.platform === 'win32') app.setAppUserModelId('cn.neu.dola');
let service: ChatService;
let window: BrowserWindow;
let quitting = false;
let tray: Tray;
let reminderTimer: ReturnType<typeof setInterval>;
let desktop: ReturnType<typeof desktopApi>;
let updates: UpdateService;
let updateEngine: AppUpdater | null = null;
let activeCommands = 0;
let notifiedVersion = '';
let acknowledgedInstall = false;
const uuid = z.string().uuid();
const modelId = z.string().trim().min(1).max(200).optional();

function registerIpc() {
  const handle = (name: string, run: (...args: any[]) => unknown) => {
    ipcMain.handle('dola:' + name, async (event, ...args) => {
      if (event.sender.isDestroyed() || window.isDestroyed()) return;
      if (event.sender !== window.webContents) throw new Error('窗口不可用');
      const workspaceCommand = !name.startsWith('updates:');
      if (workspaceCommand && updates.getState().status === 'installing')
        throw new Error('应用正在重启更新，请稍候');
      if (workspaceCommand) activeCommands++;
      try {
        return await run(...args);
      } catch (error) {
        const directory = join(service.store.dataDirectory, 'logs');
        mkdirSync(directory, { recursive: true });
        appendFileSync(
          join(directory, 'dola.log'),
          new Date().toISOString() +
            ' ' +
            name +
            '\n' +
            service.store.redact(
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            ) +
            '\n\n',
        );
        throw error;
      } finally {
        if (workspaceCommand) activeCommands--;
      }
    });
  };
  handle('load', () => service.store.snapshot());
  handle('updates:ready', async () => {
    if (process.platform === 'darwin' && app.isPackaged && !acknowledgedInstall) {
      acknowledgedInstall = true;
      await acknowledgeMacInstall(process.execPath, app.getVersion(), service.store.dataDirectory);
    }
  });
  handle('updates:get', () => updates.getState());
  handle('updates:check', () => updates.check());
  handle('updates:download', () => updates.download());
  handle('updates:cancel', () => updates.cancel());
  handle('updates:install', () => updates.install());
  handle('theme', (raw: unknown) => {
    const theme = z.enum(['light', 'dark', 'system']).parse(raw);
    service.store.setTheme(theme);
    nativeTheme.themeSource = theme;
    service.changed();
  });
  handle('provider-save', (raw: unknown) => {
    const input = providerInput.parse(raw);
    const provider = service.store.saveProvider(input);
    service.changed();
    return provider;
  });
  handle('provider-remove', (id: unknown) => {
    service.store.removeProvider(uuid.parse(id));
    service.changed();
  });
  handle('provider-probe', (id: unknown) => service.probe(uuid.parse(id)));
  handle('provider-probe-input', (raw: unknown) => service.probeInput(providerInput.parse(raw)));
  handle('provider-models', (raw: unknown) =>
    service.listModels(providerConnectionInput.parse(raw)),
  );
  handle('chat-create', (id: unknown, model: unknown) => {
    const chatId = service.store.createChat(
      id === undefined ? undefined : uuid.parse(id),
      modelId.parse(model),
    );
    service.changed();
    return chatId;
  });
  handle('chat-provider', (chatId: unknown, providerId: unknown, model: unknown) =>
    service.selectModel(uuid.parse(chatId), uuid.parse(providerId), modelId.parse(model)),
  );
  handle('chat-remove', (id: unknown) => service.removeChat(uuid.parse(id)));
  handle('chat-send', (id: unknown, text: unknown, attachments: unknown) =>
    service.send(
      uuid.parse(id),
      z.string().trim().max(100000).parse(text),
      z.array(uuid).max(6).default([]).parse(attachments),
    ),
  );
  handle('chat-attachments-choose', async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: '添加 AI 引用文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'PDF、图片或文字文件',
          extensions: [
            'pdf',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'txt',
            'md',
            'csv',
            'tsv',
            'json',
            'log',
            'py',
            'js',
            'ts',
            'html',
            'xml',
            'yaml',
            'yml',
          ],
        },
      ],
    });
    if (selected.canceled) return [];
    if (selected.filePaths.length > 6) throw new Error('每次最多添加 6 个引用文件。');
    const files = [];
    try {
      for (const path of selected.filePaths) files.push(await service.attachments.addFile(path));
      return files;
    } catch (error) {
      await service.attachments.discard(files.map((file) => file.id));
      throw error;
    }
  });
  handle('chat-attachments-discard', (ids: unknown) =>
    service.attachments.discard(z.array(uuid).max(6).parse(ids)),
  );
  handle('chat-attachment-open', async (id: unknown) => {
    const file = await service.attachments.get(uuid.parse(id));
    const error = await shell.openPath(file.path);
    if (error) throw new Error(error);
  });
  handle('chat-stop', (id: unknown) => service.stop(uuid.parse(id)));
  handle('chat-undo-creation', (chatId: unknown, messageId: unknown, creationId: unknown) =>
    service.undoCreation(uuid.parse(chatId), uuid.parse(messageId), uuid.parse(creationId)),
  );
  for (const [name, run] of Object.entries(desktop.api)) handle('workspace:' + name, run);
}

function showWindow() {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
  } else void createWindow();
}

function showUpdates() {
  if (!updates) return;
  showWindow();
  const send = () => window.webContents.send('dola:updates:open');
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send);
  else send();
}

function previousUpdateError(directory: string) {
  try {
    const status = readFileSync(join(directory, 'updates/mac-install-status'), 'utf8').trim();
    if (status === 'rolled-back') return '上次更新启动失败，已恢复原版本。请重新检查更新。';
    if (status === 'recovery-required')
      return '上次安装需要手动恢复，请查看本地 updates/install.log。';
  } catch {
    // Existing profiles have no update receipt until their first installation.
  }
  return undefined;
}

async function createWindow() {
  window = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'NEU Dot',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'assets/icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151f23' : '#f2f1ed',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app
  .whenReady()
  .then(async () => {
    // Electron has initialized the Keychain service name before emitting ready.
    app.setName('NEU Dot');
    app.on('activate', showWindow);
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              {
                label: '检查更新…',
                click: () => {
                  showUpdates();
                  void updates?.check();
                },
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          { role: 'fileMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ]),
      );
    }
    const store = new Store(app.getPath('userData'), {
      encrypt(text) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('系统密钥存储不可用，暂时无法保存 API Key');
        return safeStorage.encryptString(text);
      },
      decrypt(data) {
        return safeStorage.decryptString(data);
      },
    });
    nativeTheme.themeSource = store.theme;
    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows())
        win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#151f23' : '#f2f1ed');
    });
    service = new ChatService(store, (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('dola:change', state);
    });
    await service.attachments.cleanup().catch((error: NodeJS.ErrnoException) => {
      console.warn('引用文件清理未完成', error.code);
    });
    desktop = desktopApi(
      store,
      () => service.changed(),
      () => window,
      showWindow,
    );
    if (app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')) {
      updateEngine =
        process.platform === 'darwin' ? new MacZipUpdater() : new electronUpdater.NsisUpdater();
      updateEngine.logger = null;
    }
    updates = new UpdateService(updateEngine, {
      version: app.getVersion(),
      enabled: app.isPackaged && updateEngine !== null,
      initialError:
        process.platform === 'darwin' ? previousUpdateError(store.dataDirectory) : undefined,
      publish: (state) => {
        if (window && !window.isDestroyed()) window.webContents.send('dola:updates:change', state);
        if (state.status === 'available' && state.version !== notifiedVersion) {
          notifiedVersion = state.version || '';
          if (Notification.isSupported()) {
            const notification = new Notification({
              title: 'NEU Dot 有新版本',
              body: `发现版本 ${state.version}，点击查看并更新。`,
            });
            notification.on('click', showUpdates);
            notification.show();
          }
        }
      },
      beforeInstall: () => {
        if (activeCommands || store.chats.some((chat) => service.busy(chat.id)))
          throw new Error('请等待当前操作或 AI 回复完成，再重启更新。');
        store.saveChats();
        store.saveWorkspace();
      },
      install: async (event) => {
        if (process.platform === 'darwin') {
          const archive = event.files.find(
            (file) => basename(decodeURIComponent(file.url)) === basename(event.downloadedFile),
          );
          if (!archive?.sha512) throw new Error('更新包缺少校验信息，请重新下载');
          await prepareMacInstall({
            executable: process.execPath,
            archive: event.downloadedFile,
            sha512: archive.sha512,
            version: event.version,
            dataDirectory: store.dataDirectory,
            helper: join(process.resourcesPath, 'mac-update-helper.sh'),
          });
          quitting = true;
          setTimeout(() => app.quit(), 150);
        } else {
          quitting = true;
          updateEngine!.quitAndInstall(true, true);
        }
      },
      installFailed: () => {
        quitting = false;
      },
    });
    registerIpc();
    await createWindow();
    const icon = nativeImage
      .createFromPath(
        app.isPackaged
          ? join(process.resourcesPath, 'icon.png')
          : join(app.getAppPath(), 'assets/icon.png'),
      )
      .resize({ width: 18, height: 18 });
    tray = new Tray(icon);
    tray.setToolTip('NEU Dot · 后台提醒运行中');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 NEU Dot', click: showWindow },
        {
          label: '检查更新…',
          click: () => {
            showUpdates();
            void updates.check();
          },
        },
        { type: 'separator' },
        { label: '退出并停止提醒', click: () => app.quit() },
      ]),
    );
    tray.on('click', showWindow);
    reminderTimer = setInterval(() => {
      try {
        desktop.service.tick();
      } catch (error) {
        console.error('提醒失败：', error instanceof Error ? error.message : '系统通知不可用');
      }
    }, 15000);
    powerMonitor.on('resume', () => desktop.service.tick());
    desktop.service.tick();
    updates.start();
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : '启动失败';
    console.error(message);
    dialog.showErrorBox(
      'NEU Dot 无法打开工作台',
      message + '\n\n请重新打开应用；本机数据不会被重置。',
    );
    app.exit(1);
  });

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
  clearInterval(reminderTimer);
  updates?.dispose();
  service?.stopAll();
});
app.on('window-all-closed', () => {});
