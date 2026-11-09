const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDeviceStatus: () => ipcRenderer.invoke('phone:get-status'),
  listPhone: (dir) => ipcRenderer.invoke('phone:list', dir),
  listLocal: (dir) => ipcRenderer.invoke('local:list', dir),
  getStartPaths: () => ipcRenderer.invoke('app:get-start-paths'),
  startTransfer: (options) => ipcRenderer.invoke('transfer:start', options),
  cancelTransfer: () => ipcRenderer.invoke('transfer:cancel'),
  onTransferProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('transfer:progress', listener);
    return () => ipcRenderer.removeListener('transfer:progress', listener);
  },
  prepareForFinder: (options) => ipcRenderer.invoke('dragcache:prepare', options),
  isFinderReady: (options) => ipcRenderer.invoke('dragcache:is-ready', options),
  startNativeDrag: (options) => ipcRenderer.invoke('drag:start-native', options),
  previewPhoneFile: (options) => ipcRenderer.invoke('preview:phone-file', options),
  openLocalFile: (filePath) => ipcRenderer.invoke('open:local-file', filePath),
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch (_) {}
    return file.path || '';
  }
});
