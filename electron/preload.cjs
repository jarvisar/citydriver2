const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('citydriverDesktop', {
  getFullscreen: () => ipcRenderer.invoke('citydriver:fullscreen-get'),
  toggleFullscreen: () => ipcRenderer.invoke('citydriver:fullscreen-toggle'),
  onFullscreenChange: callback => {
    ipcRenderer.on('citydriver:fullscreen-changed', (_event, active) => callback(active));
  },
  onEscape: callback => {
    ipcRenderer.on('citydriver:escape', () => callback());
  },
  getUpdate: () => ipcRenderer.invoke('citydriver:update-get'),
  onUpdate: callback => {
    ipcRenderer.on('citydriver:update-available', (_event, update) => callback(update));
  },
});
