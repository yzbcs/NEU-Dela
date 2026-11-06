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
} from 'electron';
import { join } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from './store';
import { ChatService } from './chat';
import { providerConnectionInput, providerInput } from '../shared/validation';
import type { ProviderInput } from '../shared/types';
import { desktopApi } from './desktop';

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
const uuid = z.string().uuid();
const modelId = z.string().trim().min(1).max(200).optional();

function registerIpc() {
  const handle = (name: string, run: (...args: any[]) => unknown) => {
    ipcMain.handle('dola:' + name, async (event, ...args) => {
      if (event.sender.isDestroyed() || window.isDestroyed()) return;
      if (event.sender !== window.webContents) throw new Error('窗口不可用');
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
      }
    });
  };
  handle('load', () => service.store.snapshot());
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
  handle('chat-send', (id: unknown, text: unknown, workspaceAccess: unknown) =>
    service.send(
      uuid.parse(id),
      z.string().trim().min(1).max(100000).parse(text),
      z.boolean().default(true).parse(workspaceAccess),
    ),
  );
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

async function createWindow() {
  window = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'NEU-Dela',
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
    app.setName('NEU-Dela');
    app.on('activate', showWindow);
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
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
    // 仅开发演示脚本传入人工配置，普通启动不读取环境中的真实模型密钥。
    if (process.env.DOLA_DEMO_CONFIG) {
      const providers = JSON.parse(
        readFileSync(process.env.DOLA_DEMO_CONFIG, 'utf8'),
      ) as ProviderInput[];
      for (const provider of providers)
        store.saveProvider({
          ...provider,
          id: store.providers.find((p) => p.name === provider.name)?.id,
        });
    }
    nativeTheme.themeSource = store.theme;
    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows())
        win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#151f23' : '#f2f1ed');
    });
    service = new ChatService(store, (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('dola:change', state);
    });
    desktop = desktopApi(
      store,
      () => service.changed(),
      () => window,
      showWindow,
    );
    registerIpc();
    await createWindow();
    if (!process.argv.some((arg) => arg.startsWith('--smoke-'))) {
      const icon = nativeImage
        .createFromPath(
          app.isPackaged
            ? join(process.resourcesPath, 'icon.png')
            : join(app.getAppPath(), 'assets/icon.png'),
        )
        .resize({ width: 18, height: 18 });
      tray = new Tray(icon);
      tray.setToolTip('NEU-Dela · 后台提醒运行中');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '打开 NEU-Dela', click: showWindow },
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
    }
    if (
      process.argv.includes('--smoke-ai') ||
      process.argv.includes('--smoke-restore') ||
      process.argv.includes('--smoke-design') ||
      process.argv.includes('--smoke-actions') ||
      process.argv.includes('--smoke-actions-restore') ||
      process.argv.includes('--smoke-local-files') ||
      process.argv.includes('--smoke-local-files-restore')
    ) {
      try {
        if (process.argv.some((arg) => arg.startsWith('--smoke-local-files'))) {
          const { runLocalFilesSmoke } = await import('./local-files-smoke');
          await runLocalFilesSmoke(
            service,
            window,
            process.argv.includes('--smoke-local-files-restore'),
          );
        } else if (process.argv.some((arg) => arg.startsWith('--smoke-actions'))) {
          const { runActionsSmoke } = await import('./actions-smoke');
          await runActionsSmoke(
            service,
            window,
            desktop.openTodo,
            process.argv.includes('--smoke-actions-restore'),
          );
        } else if (process.argv.includes('--smoke-design')) {
          const { runDesignSmoke } = await import('./design-smoke');
          await runDesignSmoke(service, window);
        } else {
          const { runDesktopSmoke, runRestoreSmoke } = await import('./smoke');
          if (process.argv.includes('--smoke-restore')) await runRestoreSmoke(service, window);
          else await runDesktopSmoke(service, window);
        }
        app.exit(0);
      } catch (error) {
        const directory = join(
          process.cwd(),
          process.argv.some((arg) => arg.startsWith('--smoke-local-files'))
            ? 'assets/output/local-files-validation'
            : process.argv.some((arg) => arg.startsWith('--smoke-actions'))
              ? 'assets/output/actions-validation'
              : process.argv.includes('--smoke-design')
                ? 'assets/output/design-validation'
                : 'assets/output/ai-validation',
        );
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'desktop-error.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        writeFileSync(
          join(directory, 'desktop-ui-error.txt'),
          await window.webContents.executeJavaScript('document.body.innerText'),
        );
        writeFileSync(
          join(directory, 'desktop-error.txt'),
          error instanceof Error ? (error.stack ?? error.message) : String(error),
        );
        console.error('桌面冒烟失败，详情已保存到 ' + join(directory, 'desktop-error.txt'));
        app.exit(1);
      }
    }
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : '启动失败';
    console.error(message);
    dialog.showErrorBox(
      'NEU-Dela 无法打开工作台',
      message + '\n\n请重新打开应用；本机数据不会被重置。',
    );
    app.exit(1);
  });

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
  clearInterval(reminderTimer);
  service?.stopAll();
});
app.on('window-all-closed', () => {});
