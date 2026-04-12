const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');

let mainWindow;
let tray;

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 750,
    minWidth: 300,
    minHeight: 500,
    frame: false,
    transparent: false,
    resizable: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: '#0a0a1a',
  });

  mainWindow.loadFile('index.html');
  
  // Dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Handle WebRTC Media Permissions — essential for softphone audio
  // Allow all media-related permissions automatically (like native softphones)
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    // Allow media, audioCapture, display-capture for SIP/WebRTC
    const allowedPermissions = ['media', 'audioCapture', 'display-capture', 'mediaKeySystem', 'clipboard-read'];
    if (allowedPermissions.includes(permission)) return true;
    return true; // Allow all for local app
  });
  
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Auto-approve all permissions for our softphone app
    callback(true);
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Simple tray icon
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Ochish', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: 'Chiqish', click: () => { app.exit(0); } }
  ]);
  tray.setToolTip('Gilam Operator');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

// IPC handlers for window control
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on('window-close', () => mainWindow && mainWindow.hide());
ipcMain.on('window-quit', () => app.exit(0));

// Open external links
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
