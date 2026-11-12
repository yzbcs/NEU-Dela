import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DolaApi, AppState, ProviderConnectionInput, ProviderInput } from '../shared/types';
import type { WorkspaceApi } from '../shared/workspace';
import type { UpdateState } from '../shared/updates';

const workspaceMethods: (keyof WorkspaceApi)[] = [
  'saveTodo',
  'toggleTodo',
  'undoTodo',
  'removeTodo',
  'testNotification',
  'importTimetable',
  'importWebTimetable',
  'saveTimetable',
  'updateTimetableSettings',
  'exportTimetable',
  'saveNote',
  'saveNotebook',
  'removeNotebook',
  'removeNote',
  'exportNote',
  'addResources',
  'addResourcePaths',
  'addLink',
  'removeResource',
  'openResource',
  'listResourceDirectory',
  'readResourceFile',
  'listReadingAnnotations',
  'addReadingAnnotation',
  'updateReadingAnnotation',
  'removeReadingAnnotation',
  'translateReadingText',
  'cancelReadingTranslation',
  'summarizeReadingFile',
  'readResourceImage',
  'resolveResourceLink',
  'openResourcePath',
  'openLocal',
  'openWebsite',
  'setDegree',
  'saveMailAccount',
  'removeMailAccount',
  'testMailAccount',
  'testMailConnection',
  'mailFolders',
  'mailList',
  'mailCached',
  'mailRead',
  'mailAttachment',
  'mailSend',
  'getDiagnostics',
  'showDataFolder',
  'getAppInfo',
];

contextBridge.exposeInMainWorld('dola', {
  pathForDroppedFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform,
  updates: {
    getState: () => ipcRenderer.invoke('dola:updates:get'),
    check: () => ipcRenderer.invoke('dola:updates:check'),
    download: () => ipcRenderer.invoke('dola:updates:download'),
    cancel: () => ipcRenderer.invoke('dola:updates:cancel'),
    install: () => ipcRenderer.invoke('dola:updates:install'),
    confirmLaunch: () => ipcRenderer.invoke('dola:updates:ready'),
    onChange: (listener) => {
      const handler = (_event: unknown, state: UpdateState) => listener(state);
      ipcRenderer.on('dola:updates:change', handler);
      return () => ipcRenderer.removeListener('dola:updates:change', handler);
    },
    onOpen: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('dola:updates:open', handler);
      return () => ipcRenderer.removeListener('dola:updates:open', handler);
    },
  },
  workspace: Object.fromEntries(
    workspaceMethods.map((name) => [
      name,
      (...args: unknown[]) => ipcRenderer.invoke('dola:workspace:' + name, ...args),
    ]),
  ) as unknown as WorkspaceApi,
  load: () => ipcRenderer.invoke('dola:load'),
  setTheme: (theme) => ipcRenderer.invoke('dola:theme', theme),
  saveProvider: (input: ProviderInput) => ipcRenderer.invoke('dola:provider-save', input),
  removeProvider: (id: string) => ipcRenderer.invoke('dola:provider-remove', id),
  probeProvider: (id: string) => ipcRenderer.invoke('dola:provider-probe', id),
  probeProviderInput: (input: ProviderInput) =>
    ipcRenderer.invoke('dola:provider-probe-input', input),
  listModels: (input: ProviderConnectionInput) => ipcRenderer.invoke('dola:provider-models', input),
  createChat: (id?: string, model?: string) => ipcRenderer.invoke('dola:chat-create', id, model),
  selectProvider: (chatId: string, providerId: string, model?: string) =>
    ipcRenderer.invoke('dola:chat-provider', chatId, providerId, model),
  removeChat: (id: string) => ipcRenderer.invoke('dola:chat-remove', id),
  send: (id: string, text: string, attachments?: string[]) =>
    ipcRenderer.invoke('dola:chat-send', id, text, attachments),
  chooseChatAttachments: () => ipcRenderer.invoke('dola:chat-attachments-choose'),
  discardChatAttachments: (ids: string[]) =>
    ipcRenderer.invoke('dola:chat-attachments-discard', ids),
  openChatAttachment: (id: string) => ipcRenderer.invoke('dola:chat-attachment-open', id),
  stop: (id: string) => ipcRenderer.invoke('dola:chat-stop', id),
  undoCreation: (chatId: string, messageId: string, creationId: string) =>
    ipcRenderer.invoke('dola:chat-undo-creation', chatId, messageId, creationId),
  onOpenTodo: (listener: (id: string) => void) => {
    const handler = (_event: unknown, id: string) => listener(id);
    ipcRenderer.on('dola:open-todo', handler);
    return () => ipcRenderer.removeListener('dola:open-todo', handler);
  },
  onChange: (listener: (state: AppState) => void) => {
    const handler = (_event: unknown, state: AppState) => listener(state);
    ipcRenderer.on('dola:change', handler);
    return () => ipcRenderer.removeListener('dola:change', handler);
  },
} satisfies DolaApi);
