import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import updater from 'electron-updater';

const { autoUpdater } = updater;
const origin = 'gastrolab://localhost';
const appId = 'com.gastrolab.pos';
let updateInProgress = false;
let downloaded = false;

protocol.registerSchemesAsPrivileged([{
  scheme: 'gastrolab',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);
app.setAppUserModelId(appId);
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function trustedRenderer(event) {
  const url = new URL(event.senderFrame?.url ?? 'about:blank');
  return url.protocol === 'gastrolab:' && url.host === 'localhost';
}

ipcMain.handle('gastrolab:check-update', async (event) => {
  if (!trustedRenderer(event) || !app.isPackaged) return 'disabled';
  if (downloaded) return 'downloaded';
  if (updateInProgress) return 'busy';
  updateInProgress = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) return 'current';
    await autoUpdater.downloadUpdate();
    downloaded = true;
    return 'downloaded';
  } finally {
    updateInProgress = false;
  }
});

ipcMain.handle('gastrolab:install-update', (event) => {
  if (trustedRenderer(event) && downloaded) autoUpdater.quitAndInstall();
});

function createWindow(url = origin) {
  const window = new BrowserWindow({
    width: 1366,
    height: 900,
    icon: resolve(app.getAppPath(), 'dist/pwa-512x512.png'),
    webPreferences: {
      preload: resolve(app.getAppPath(), 'electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(origin + '/')) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    const url = new URL(target);
    if (url.protocol === 'gastrolab:' && url.host === 'localhost' &&
        url.pathname === '/' && url.searchParams.get('pantalla') === 'cliente') {
      createWindow(target);
    } else if (url.protocol === 'https:' || url.protocol === 'mailto:') {
      void shell.openExternal(target).catch(() => {});
    }
    return { action: 'deny' };
  });
  void window.loadURL(url);
}

app.whenReady().then(() => {
  const root = resolve(app.getAppPath(), 'dist');
  protocol.handle('gastrolab', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'localhost') return new Response(null, { status: 404 });
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
