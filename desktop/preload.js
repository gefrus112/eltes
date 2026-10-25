/* The only bridge between the page and the desktop shell.
   Context isolation is on and node integration is off: the site gets these
   five calls and nothing else. There is no filesystem access, no process
   control and no raw IPC handle in the page. */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  info: () => ipcRenderer.invoke('desktop:info'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', String(url)),
  openLogs: () => ipcRenderer.invoke('desktop:open-path', 'logs'),
  openStudio: () => ipcRenderer.invoke('desktop:open-path', 'studio'),
  retry: () => ipcRenderer.invoke('desktop:retry')
};

contextBridge.exposeInMainWorld('EltesDesktop', Object.freeze(api));
