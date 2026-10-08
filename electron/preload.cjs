const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tierflow', {
  platform: process.platform,
  invoke: async (action, input) => { const result = await ipcRenderer.invoke('tierflow:invoke', action, input); if (!result.ok) throw new Error(result.error); return result.data; },
  subscribe: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on('tierflow:change', handler); return () => ipcRenderer.removeListener('tierflow:change', handler); },
});
