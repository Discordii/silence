const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickInputFile: () => ipcRenderer.invoke('pick-input-file'),
  pickOutputPath: (suggestedName) => ipcRenderer.invoke('pick-output-path', suggestedName),
  processVideo: (options) => ipcRenderer.invoke('process-video', options),
  onStatus: (callback) => {
    ipcRenderer.on('process-status', (_event, payload) => callback(payload));
  }
});
