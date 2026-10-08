const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { AtemTallyClient } = require('./atem');
const { store } = require('./settings');
import { IPC_CHANNELS } from '../shared/types';
import type { TallyState } from '../shared/types';

// Tray icon: red/green tally circle (base64 PNG), visible on all platforms.
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjklEQVR42u3XMQrAIAwFUE/inMVr9P5bj2OngtSS5gcln5JAVv/TQWMpWWCJSNc6LHgbZFy0tzp1PY+pl0G0YA3whGwL/wK4EdZwCwBGIOFWAIRAwhHAjVi6ew9ARaDhKEA9Bc/uvYBXRAISkIBwQPhFRHEVhz9GFM9x+EBCMZJRDKUUYznFx4Tma/bbugDk/AV+tuUXPgAAAABJRU5ErkJggg==';


let settingsWindow: any = null;
let overlayWindow: any = null;
let tray: any = null;
let atemClient: any = null;
let atemStatus = 'disconnected';
let currentTallyState: TallyState = 'off';

// --- Embedded Web Server (serves the web tally for Stage Display / iframes) ---
let server: any = null;
let wss: any = null;

function webDir(): string {
  return app.isPackaged
    ? path.join((process as any).resourcesPath, 'web')
    : path.join(app.getAppPath(), 'src', 'web');
}

function publicDir(): string {
  return app.isPackaged
    ? path.join((process as any).resourcesPath, 'web', 'public')
    : path.join(app.getAppPath(), 'src', 'web', 'public');
}

function broadcastWebTally(state: TallyState) {
  currentTallyState = state;
  const payload = JSON.stringify({ type: 'tally-change', state });
  if (wss) {
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  }
}

function startWebServer() {
  const webApp = express();
  server = http.createServer(webApp);
  wss = new WebSocket.Server({ server });
  webApp.use(express.static(publicDir()));
  wss.on('connection', (ws: any) => {
    ws.send(JSON.stringify({ type: 'tally-change', state: currentTallyState }));
  });
  const port = store.get('webServerPort');
  server.on('error', (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `Web Tally server could not bind to port ${port}: address already in use. ` +
          `Change the Web Server Port in Settings, or quit the process holding it.`,
      );
    } else {
      console.error('Web Tally server error:', err);
    }
  });
  server.listen(port, () => {
    console.log(`Web Tally server active at http://localhost:${port}/tally.html`);
  });
}

function restartWebServer() {
  if (server) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }
  startWebServer();
}

// --- Window helpers ---
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 740,
    show: false,
    webPreferences: {
      preload: path.join(webDir(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(webDir(), 'settings.html'));
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.removeAllListeners('closed');
    overlayWindow.destroy();
    overlayWindow = null;
  }
  const port = store.get('webServerPort');
  const style = store.get('overlayStyle') || 'border';
  const width = store.get('borderWidth') || 14;
  const showLabel = store.get('overlayShowLabel') !== false;

  // Position the overlay on the chosen display (displayId is a 0-based index
  // into the system's display list; null/undefined => primary display).
  const displayId = store.get('displayId');
  const displays = screen.getAllDisplays();
  const target =
    typeof displayId === 'number' && displays[displayId]
      ? displays[displayId]
      : screen.getPrimaryDisplay();
  const bounds = target.bounds;

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.loadURL(
    `http://localhost:${port}/tally.html?showLabel=${showLabel ? 'true' : 'false'}&style=${encodeURIComponent(style)}&width=${encodeURIComponent(width)}`
  );
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => createSettingsWindow() },
    {
      label: 'Show Overlay',
      click: () => createOverlayWindow(),
    },
    {
      label: 'Hide Overlay',
      click: () => {
        if (overlayWindow) {
          overlayWindow.destroy();
          overlayWindow = null;
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('TallyConnect');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => createSettingsWindow());
}

// --- Tally fan-out ---
function sendTallyUpdate(state: TallyState) {
  currentTallyState = state;
  // The overlay receives tally via the WebSocket, not IPC.
  if (settingsWindow) settingsWindow.webContents.send(IPC_CHANNELS.TALLY_CHANGE, state);
  broadcastWebTally(state);
}

// --- IPC ---
ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => ({
  atemIp: store.get('atemIp'),
  inputNumber: store.get('inputNumber'),
    displayId: store.get('displayId'),
    overlayStyle: store.get('overlayStyle'),
    borderWidth: store.get('borderWidth'),
    overlayShowLabel: store.get('overlayShowLabel'),
    webServerPort: store.get('webServerPort'),
  status: atemStatus,
}));

ipcMain.handle(IPC_CHANNELS.APP_QUIT, () => {
  app.quit();
});

ipcMain.handle(IPC_CHANNELS.SAVE_SETTINGS, (_e: any, settings: any) => {
  const prevPort = store.get('webServerPort');

  if (settings.atemIp !== undefined) store.set('atemIp', settings.atemIp);
  if (settings.inputNumber !== undefined) store.set('inputNumber', settings.inputNumber);
  if (settings.displayId !== undefined) store.set('displayId', settings.displayId);
  if (settings.overlayStyle !== undefined) store.set('overlayStyle', settings.overlayStyle);
  if (settings.borderWidth !== undefined) store.set('borderWidth', settings.borderWidth);
  if (settings.overlayShowLabel !== undefined) store.set('overlayShowLabel', settings.overlayShowLabel);
  if (settings.webServerPort !== undefined) store.set('webServerPort', settings.webServerPort);

  atemClient?.updateConfig({
    ip: store.get('atemIp'),
    inputNumber: store.get('inputNumber'),
  });

  if (store.get('webServerPort') !== prevPort) {
    restartWebServer();
  }

  // Recreate the overlay if its appearance, target display, or the web port
  // (embedded in its URL) changed.
  if (
    settings.displayId !== undefined ||
    settings.overlayStyle !== undefined ||
    settings.borderWidth !== undefined ||
    settings.overlayShowLabel !== undefined ||
    store.get('webServerPort') !== prevPort
  ) {
    if (store.get('displayId') !== null) {
      createOverlayWindow();
    } else if (overlayWindow) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
  }
  return true;
});

// --- App lifecycle ---
app.whenReady().then(() => {
  startWebServer();

  atemClient = new AtemTallyClient({
    ip: store.get('atemIp'),
    inputNumber: store.get('inputNumber'),
  });
  atemClient.onTally((state: TallyState) => sendTallyUpdate(state));
  atemClient.onStatus((status: string) => {
    atemStatus = status;
    if (settingsWindow) settingsWindow.webContents.send(IPC_CHANNELS.ATEM_STATUS, status);
  });
  atemClient.connect();

  createTray();
  createSettingsWindow();
  if (store.get('displayId') !== null) createOverlayWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createSettingsWindow();
});
