const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');

let mainWindow;
let tray;

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

// ─── MAIN WINDOW ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 750,
    minWidth: 300,
    minHeight: 500,
    frame: false,
    transparent: false,
    resizable: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#0a0a1a',
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.session.setPermissionCheckHandler(() => true);
  mainWindow.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(true));

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── TRAY ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Gilam Operator');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '📂 Ochish', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: '❌ Chiqish', click: () => app.exit(0) },
  ]));
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

// ─── APP READY ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
});

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.hide());
ipcMain.on('window-quit', () => app.exit(0));
ipcMain.on('open-external', (_, url) => shell.openExternal(url));

app.on('window-all-closed', () => {});
app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});
