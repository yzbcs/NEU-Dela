import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('timetableImport', {
  read: () => ipcRenderer.send('dola:timetable:read'),
  back: () => ipcRenderer.send('dola:timetable:back'),
  reload: () => ipcRenderer.send('dola:timetable:reload'),
  onStatus: (listener: (message: string) => void) => {
    ipcRenderer.on('dola:timetable:status', (_event, message: string) => listener(message));
  },
});
