const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gastrolabUpdates', {
  check: () => ipcRenderer.invoke('gastrolab:check-update'),
  install: () => ipcRenderer.invoke('gastrolab:install-update'),
});
