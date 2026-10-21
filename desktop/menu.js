/* The application menu, kept as plain data so it can be tested without Electron.
   desktop/main.js hands the template to Menu.buildFromTemplate and maps each
   `run` name to a real action. */

'use strict';

function menuTemplate(options = {}) {
  const platform = options.platform || process.platform;
  const appName = options.appName || 'Eltes';
  const actions = options.actions || {};
  const dev = !!options.dev;
  const isMac = platform === 'darwin';

  const item = (label, run, extra = {}) => ({ id: run, label, click: () => actions[run] && actions[run](), ...extra });
  const separator = { type: 'separator' };

  const appMenu = isMac ? [{
    label: appName,
    submenu: [
      { role: 'about', label: `About ${appName}` },
      separator,
      item('Open logs', 'openLogs'),
      item('Open Studio folder', 'openStudioFolder'),
      separator,
      { role: 'services' },
      separator,
      { role: 'hide', label: `Hide ${appName}` },
      { role: 'hideOthers' },
      { role: 'unhide' },
      separator,
      { role: 'quit', label: `Quit ${appName}` }
    ]
  }] : [];

  const file = {
    label: 'File',
    submenu: [
      item('New chat', 'newChat', { accelerator: 'CmdOrCtrl+N' }),
      item('Open workspace', 'openWorkspace', { accelerator: 'CmdOrCtrl+O' }),
      item('Open Studio', 'openStudio', { accelerator: 'CmdOrCtrl+Shift+S' }),
      separator,
      item('Open logs', 'openLogs'),
      item('Open Studio folder', 'openStudioFolder'),
      separator,
      isMac ? { role: 'close', label: 'Close window' } : { role: 'quit', label: `Quit ${appName}` }
    ]
  };

  const edit = {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, separator,
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]
  };

  const view = {
    label: 'View',
    submenu: [
      item('Reload', 'reload', { accelerator: 'CmdOrCtrl+R' }),
      separator,
      { role: 'resetZoom', label: 'Actual size' },
      { role: 'zoomIn', label: 'Zoom in' },
      { role: 'zoomOut', label: 'Zoom out' },
      separator,
      { role: 'togglefullscreen', label: 'Full screen' },
      ...(dev ? [separator, { role: 'toggleDevTools', label: 'Developer tools' }] : [])
    ]
  };

  const window = {
    label: 'Window',
    submenu: [
      { role: 'minimize', label: 'Minimize' },
      ...(isMac ? [{ role: 'zoom', label: 'Zoom' }, separator, { role: 'front', label: 'Bring all to front' }] : [])
    ]
  };

  const help = {
    label: 'Help',
    submenu: [
      item('Documentation', 'openDocs'),
      item('Lab and training', 'openLab'),
      item('Release notes', 'openNews'),
      separator,
      item('GitHub repository', 'openGitHub'),
      item('Report an issue', 'openIssues'),
      ...(isMac ? [] : [separator, item(`About ${appName}`, 'showAbout')])
    ]
  };

  return [...appMenu, file, edit, view, window, help];
}

module.exports = { menuTemplate };
