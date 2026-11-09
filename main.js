const { app, BrowserWindow, ipcMain, session, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const adb = require('./src/adb');
const phoneFs = require('./src/phone-fs');
const localFs = require('./src/local-fs');
const { TransferJob } = require('./src/transfer');
const dragcache = require('./src/dragcache');
const preview = require('./src/preview');
const guard = require('./src/ipc-guard');
const { pathToFileURL } = require('url');

// Only the app's own page may call the main process. Phone file names are shown in that page, so its
// requests are also checked (see src/ipc-guard.js) before anything touches adb or the disk.
const RENDERER_URL = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame && event.senderFrame.url;
    if (url !== RENDERER_URL) throw new Error('Rejected request from an unexpected page');
    return fn(event, ...args);
  });
}

const PREVIEW_MAX_AGE_MS = 60 * 60 * 1000; // preview copies are deleted after an hour, and on quit

let mainWindow = null;
let currentSerial = null;
let activeTransferJob = null;
const dragCacheManager = new dragcache.DragCacheManager();

// Drag icon: a 32x32 rounded blue tile, built from raw pixels (BGRA) so it never depends on decoding a PNG.
function makeDragIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const corner = dx < 5 && dy < 5 && (5 - dx) ** 2 + (5 - dy) ** 2 > 25;
      const i = (y * size + x) * 4;
      buf[i] = 0xe0; buf[i + 1] = 0x7a; buf[i + 2] = 0x2f; // B, G, R
      buf[i + 3] = corner ? 0 : 0xd8; // alpha
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
const dragIcon = makeDragIcon();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: 'Phone Explorer',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // The window never leaves the app's own page: no links, no dropped-file navigation, no pop-ups.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Strict CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:;"]
      }
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  dragcache.wipeCache();
  preview.wipe();
  setInterval(() => preview.sweep(PREVIEW_MAX_AGE_MS), 10 * 60 * 1000).unref();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (activeTransferJob) {
    activeTransferJob.cancel();
  }
  dragCacheManager.cancel();
  dragcache.wipeCache();
  preview.wipe();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

handle('phone:get-status', async () => {
  try {
    const { stdout } = await adb.run(['devices', '-l']);
    const parsed = adb.parseDevices(stdout);

    if (parsed.primaryDevice) {
      currentSerial = parsed.primaryDevice.serial;
    } else {
      currentSerial = null;
    }

    if (parsed.primaryState === 'none') {
      return {
        state: 'none',
        message: 'Plug in your phone with a USB cable',
        device: null
      };
    } else if (parsed.primaryState === 'unauthorized') {
      return {
        state: 'unauthorized',
        message: "Tap Allow on the phone's USB debugging prompt",
        device: parsed.primaryDevice
      };
    } else if (parsed.primaryState === 'offline') {
      return {
        state: 'offline',
        message: 'Unplug and replug the cable',
        device: parsed.primaryDevice
      };
    } else if (parsed.primaryState === 'device') {
      const modelName = parsed.primaryDevice.model
        ? parsed.primaryDevice.model.replace(/_/g, ' ')
        : 'OnePlus 9 5G';
      return {
        state: 'device',
        message: `${modelName} (connected)`,
        device: parsed.primaryDevice
      };
    }

    return {
      state: parsed.primaryState,
      message: `Device status: ${parsed.primaryState}`,
      device: parsed.primaryDevice
    };
  } catch (err) {
    return {
      state: 'not_found',
      message: 'Install Android platform-tools: brew install --cask android-platform-tools',
      device: null
    };
  }
});

handle('phone:list', async (event, dir) => {
  if (!currentSerial) {
    const status = await adb.run(['devices', '-l']).catch(() => null);
    if (status) {
      const parsed = adb.parseDevices(status.stdout);
      if (parsed.primaryDevice) currentSerial = parsed.primaryDevice.serial;
    }
  }

  if (!currentSerial) {
    const err = new Error('No device connected');
    err.code = 'NO_DEVICE';
    throw err;
  }

  return await phoneFs.list(currentSerial, dir || '/sdcard');
});

handle('local:list', async (event, dir) => {
  const targetDir = dir || process.env.PHONE_EXPLORER_LOCAL_START || os.homedir();
  return await localFs.list(targetDir);
});

handle('app:get-start-paths', async () => {
  return {
    phoneStart: '/sdcard',
    localStart: process.env.PHONE_EXPLORER_LOCAL_START || os.homedir(),
    homeDir: os.homedir()
  };
});

handle('transfer:start', async (event, options) => {
  const opts = guard.checkTransfer(options);
  if (!currentSerial) throw new Error('No device connected');
  const job = new TransferJob({ ...opts, serial: currentSerial });

  activeTransferJob = job;

  job.on('progress', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer:progress', data);
    }
  });

  try {
    const result = await job.run();
    return result;
  } finally {
    activeTransferJob = null;
  }
});

handle('transfer:cancel', async () => {
  if (activeTransferJob) {
    activeTransferJob.cancel();
  }
  dragCacheManager.cancel();
  return { cancelled: true };
});

handle('dragcache:prepare', async (event, { sourceDir, items } = {}) => {
  items = guard.checkPhoneSelection(sourceDir, items);
  const serial = currentSerial;
  if (!serial) {
    throw new Error('No device connected');
  }

  return await dragCacheManager.prepare(serial, sourceDir, items, (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer:progress', data);
    }
  });
});

handle('dragcache:is-ready', async (event, { sourceDir, items } = {}) => {
  items = guard.checkPhoneSelection(sourceDir, items);
  return await dragcache.isSelectionReady(currentSerial, sourceDir, items);
});

handle('drag:start-native', async (event, { localPaths } = {}) => {
  try {
    localPaths = guard.checkCachedPaths(localPaths, dragcache.CACHE_DIR);
  } catch (err) {
    console.error(err.message);
    return false;
  }
  const primaryFile = localPaths[0];

  if (process.env.PHONE_EXPLORER_TEST) {
    (global.__dragCalls = global.__dragCalls || []).push(localPaths);
    global.__dragIconEmpty = dragIcon.isEmpty();
    return true;
  }

  try {
    event.sender.startDrag({
      file: primaryFile,
      files: localPaths,
      icon: dragIcon
    });
    return true;
  } catch (err) {
    console.error('startDrag error:', err);
    return false;
  }
});

// Open a file with its default app. Only photos, videos, music and documents open; anything else is revealed in Finder.
async function openFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return { opened: false, error: 'Invalid file path' };
  }
  if (!preview.isSafeToOpen(filePath)) {
    if (!process.env.PHONE_EXPLORER_TEST) shell.showItemInFolder(filePath);
    return { opened: false, revealed: true, path: filePath };
  }
  if (process.env.PHONE_EXPLORER_TEST) return { opened: false, skipped: true, path: filePath };
  const error = await shell.openPath(filePath);
  return error ? { opened: false, error, path: filePath } : { opened: true, path: filePath };
}

handle('open:local-file', async (event, filePath) => openFile(filePath));

// Double-click on a phone file: copy it to a temp folder, then open it. The copy is deleted later.
handle('preview:phone-file', async (event, { sourceDir, entry } = {}) => {
  [entry] = guard.checkPhoneSelection(sourceDir, [entry]);
  if (entry.isDir) return { error: 'Folders cannot be previewed' };
  if (!currentSerial) {
    const err = new Error('No device connected');
    err.code = 'NO_DEVICE';
    throw err;
  }
  if (activeTransferJob) return { busy: true };

  const destDir = preview.newPreviewDir();
  const job = new TransferJob({
    direction: 'pull',
    serial: currentSerial,
    sourceDir,
    destDir,
    items: [entry]
  });
  activeTransferJob = job;
  job.on('progress', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transfer:progress', data);
    }
  });

  let result;
  try {
    result = await job.run();
  } finally {
    activeTransferJob = null;
  }

  const filePath = path.join(destDir, entry.name);
  if (result.cancelled) {
    preview.removeDir(destDir);
    return { cancelled: true };
  }
  if (!result.success || !fs.existsSync(filePath) || !preview.makeInert(filePath)) {
    preview.removeDir(destDir);
    return { error: (result.errors && result.errors[0] && (result.errors[0].message || String(result.errors[0]))) || 'Could not copy the file from the phone' };
  }
  return await openFile(filePath);
});
