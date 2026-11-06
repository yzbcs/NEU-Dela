import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('graduateImport', {
  read: () => ipcRenderer.send('dola:graduate:read'),
  back: () => ipcRenderer.send('dola:graduate:back'),
  reload: () => ipcRenderer.send('dola:graduate:reload'),
  onStatus: (listener: (message: string) => void) => {
    ipcRenderer.on('dola:graduate:status', (_event, message: string) => listener(message));
  },
});
