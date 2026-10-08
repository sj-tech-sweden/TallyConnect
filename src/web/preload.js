const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  quit: () => ipcRenderer.invoke('app-quit'),
  onTallyChange: (cb) => ipcRenderer.on('tally-change', (_e, state) => cb(state)),
  onStatusChange: (cb) => ipcRenderer.on('atem-status', (_e, status) => cb(status)),
});
