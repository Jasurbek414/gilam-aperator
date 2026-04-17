const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');

let mainWindow;
let tray;
let backendProcess = null;
let tunnelProcess = null;
let splashWindow = null;

app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

// ─── PATHS ───────────────────────────────────────────────────────────────────
// When packaged: resources/app/  or  resources/app.asar
//   backend lives in resources/backend/
//   cloudflared.exe lives in resources/cloudflared.exe
const isPackaged = app.isPackaged;
const resourcesPath = isPackaged
  ? process.resourcesPath
  : path.join(__dirname, '..', 'gilam-platforma-main');

const backendDir = isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.join(__dirname, '..', 'gilam-platforma-main', 'backend');

const cloudflaredExe = isPackaged
  ? path.join(process.resourcesPath, 'cloudflared.exe')
  : 'cloudflared'; // system PATH

const TUNNEL_TOKEN = 'eyJhIjoiMDI5NDc1MzY0YWNjNDEzY2Q2Y2YzNWVkOGU0MjEzNGIiLCJ0IjoiYzk4ZmU3YmQtZDJhMi00MmFmLWI3YzItMTcwNWE1NGExMjQ3IiwicyI6Ik16WmpOVFU0TmpZdE5EaGhPUzAwTTJObExUaG1ZMlV0TmpneE56Y3lNVFUwTlRNME56Sm1ZVGcxT0dFdE1HSTJZaTAwTVRZM0xXSTRaamt0TnpjMVpHUm1Zemt4T1RSayJ9';

// ─── SPLASH SCREEN ────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  // Inline HTML splash
  const splashHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%);
    border-radius: 16px;
    border: 1px solid rgba(99,102,241,0.3);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: 'Segoe UI', sans-serif;
    color: white;
    overflow: hidden;
  }
  .logo { font-size: 48px; margin-bottom: 12px; }
  h1 { font-size: 28px; font-weight: 700; color: #818cf8; margin-bottom: 6px; }
  p { font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 32px; }
  .status { font-size: 13px; color: #a5b4fc; margin-bottom: 16px; min-height: 20px; }
  .bar-bg {
    width: 280px; height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px; overflow: hidden;
  }
  .bar {
    height: 100%;
    background: linear-gradient(90deg, #6366f1, #818cf8);
    border-radius: 4px;
    animation: progress 8s ease forwards;
  }
  @keyframes progress { from { width:0% } to { width:90% } }
</style>
</head>
<body>
  <div class="logo">🏢</div>
  <h1>Gilam Operator</h1>
  <p>Professional Dispatch System</p>
  <div class="status" id="st">Tizim ishga tushirilmoqda...</div>
  <div class="bar-bg"><div class="bar"></div></div>
  <script>
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('splash-status', (e, msg) => {
      document.getElementById('st').textContent = msg;
    });
  </script>
</body>
</html>`;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml));
}

function setSplashStatus(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-status', msg);
  }
}

// ─── BACKEND ──────────────────────────────────────────────────────────────────
function startBackend() {
  return new Promise((resolve) => {
    try {
      const nodeExe = process.platform === 'win32'
        ? path.join(path.dirname(process.execPath), 'node.exe')
        : 'node';

      const env = {
        ...process.env,
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'postgres',
        DB_PASSWORD: 'postgres',
        DB_NAME: 'gilam_saas',
        JWT_SECRET: 'gilam-saas-jwt-secret-key-2026',
        FIREBASE_SERVICE_ACCOUNT_PATH: path.join(backendDir, 'firebase-service-account.json'),
        NODE_ENV: 'production',
        PORT: '3000',
      };

      backendProcess = spawn('node', ['dist/main.js'], {
        cwd: backendDir,
        env,
        windowsHide: true,
        detached: false,
        stdio: 'ignore',
      });

      backendProcess.on('error', (err) => {
        console.error('Backend error:', err.message);
        resolve(false);
      });

      // Poll until backend responds
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        const req = https.request({
          hostname: 'localhost',
          port: 3000,
          path: '/api/auth/login',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          rejectUnauthorized: false,
        }, (res) => {
          clearInterval(poll);
          resolve(true);
        });
        req.on('error', () => {});
        req.write('{}');
        req.end();

        // Also try http
        const http = require('http');
        const req2 = http.request({ hostname: 'localhost', port: 3000, path: '/api', method: 'GET' }, (res) => {
          clearInterval(poll);
          resolve(true);
        });
        req2.on('error', () => {});
        req2.end();

        if (attempts > 30) { // 15 seconds
          clearInterval(poll);
          resolve(true); // continue anyway
        }
      }, 500);

    } catch (e) {
      console.error('startBackend error:', e);
      resolve(false);
    }
  });
}

// ─── TUNNEL ───────────────────────────────────────────────────────────────────
function startTunnel() {
  try {
    tunnelProcess = spawn(cloudflaredExe, [
      'tunnel', '--no-autoupdate', 'run',
      '--token', TUNNEL_TOKEN,
    ], {
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
    });
    tunnelProcess.on('error', (e) => console.error('Tunnel error:', e.message));
  } catch (e) {
    console.error('startTunnel error:', e);
  }
}

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
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
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
    { label: '❌ Chiqish', click: () => {
      if (backendProcess) backendProcess.kill();
      if (tunnelProcess) tunnelProcess.kill();
      app.exit(0);
    }},
  ]));
  tray.on('double-click', () => mainWindow && mainWindow.show());
}

// ─── APP READY ────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();
  createTray();

  setSplashStatus('Backend ishga tushirilmoqda...');
  startTunnel();

  const backendOk = await startBackend();

  setSplashStatus(backendOk ? 'Tayyor! Yuklanmoqda...' : 'Ulanyapti...');
  await new Promise(r => setTimeout(r, 800));

  createWindow();
});

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.hide());
ipcMain.on('window-quit', () => {
  if (backendProcess) backendProcess.kill();
  if (tunnelProcess) tunnelProcess.kill();
  app.exit(0);
});
ipcMain.on('open-external', (_, url) => shell.openExternal(url));

app.on('window-all-closed', () => {});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
  if (tunnelProcess) tunnelProcess.kill();
});
