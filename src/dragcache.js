const fs = require('fs');
const path = require('path');
const os = require('os');
const { TransferJob } = require('./transfer');
const phoneFs = require('./phone-fs');
const localFs = require('./local-fs');

const CACHE_DIR = path.join(os.tmpdir(), 'phone-explorer-cache');
const MANIFEST_FILE = path.join(CACHE_DIR, 'manifest.json');

function getCacheDir() {
  return CACHE_DIR;
}

function wipeCache() {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  } catch (_) {}
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (_) {}
}

function loadManifest() {
  try {
    if (fs.existsSync(MANIFEST_FILE)) {
      return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveManifest(manifest) {
  try {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Checks if all items in the current selection are already cached and unchanged.
 */
async function isSelectionReady(serial, sourceDir, items) {
  const manifest = loadManifest();

  for (const item of items) {
    const remotePath = path.posix.join(sourceDir, item.name);
    const cached = manifest[remotePath];

    if (!cached || !fs.existsSync(cached.localPath)) {
      return false;
    }

    if (item.isDir) {
      // For directories, check if local folder exists
      if (!fs.existsSync(cached.localPath)) return false;
    } else {
      if (cached.size !== item.size || cached.mtimeMs !== item.mtimeMs) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Prepares the selected phone items for native Finder drag.
 * Emits progress through jobProgressCallback if provided.
 */
class DragCacheManager {
  constructor() {
    this.currentJob = null;
  }

  cancel() {
    if (this.currentJob) {
      this.currentJob.cancel();
    }
  }

  async prepare(serial, sourceDir, items, onProgress) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // Step 1: Collect files and verify sizes
    let totalSelectionBytes = 0;
    const itemsToProcess = [];

    for (const item of items) {
      const remotePath = path.posix.join(sourceDir, item.name);
      if (item.isDir) {
        const walkRes = await phoneFs.walk(serial, remotePath);
        totalSelectionBytes += walkRes.totalBytes;
        itemsToProcess.push({ item, remotePath, walkFiles: walkRes.files });
      } else {
        totalSelectionBytes += item.size || 0;
        itemsToProcess.push({ item, remotePath, walkFiles: null });
      }
    }

    // Step 2: Free space check (selection size + 1 GB)
    const requiredFree = totalSelectionBytes + (1024 * 1024 * 1024);
    const availableFree = await localFs.freeDiskSpace(CACHE_DIR);
    if (availableFree < requiredFree) {
      const err = new Error('Not enough free disk space. Requires selection size + 1 GB free space.');
      err.code = 'ENOSPC';
      throw err;
    }

    // Step 3: Check cache manifest
    const manifest = loadManifest();
    const itemsToPull = [];
    const localPathsReady = [];

    for (const entry of itemsToProcess) {
      const targetLocalPath = path.join(CACHE_DIR, entry.item.name);
      localPathsReady.push(targetLocalPath);

      if (entry.item.isDir) {
        // If directory, check individual files
        let allFilesValid = true;
        for (const file of entry.walkFiles) {
          const cachedFile = manifest[file.path];
          const destLocal = path.join(targetLocalPath, file.relPath);
          if (!cachedFile || !fs.existsSync(destLocal) || cachedFile.size !== file.size || cachedFile.mtimeMs !== file.mtimeMs) {
            allFilesValid = false;
            break;
          }
        }

        if (!allFilesValid) {
          itemsToPull.push(entry.item);
        } else {
          manifest[entry.remotePath] = {
            localPath: targetLocalPath,
            size: totalSelectionBytes,
            mtimeMs: entry.item.mtimeMs,
            isDir: true
          };
        }
      } else {
        const cached = manifest[entry.remotePath];
        if (cached && fs.existsSync(targetLocalPath) && cached.size === entry.item.size && cached.mtimeMs === entry.item.mtimeMs) {
          // Reused!
        } else {
          itemsToPull.push(entry.item);
        }
      }
    }

    // Step 4: Pull missing/changed items
    if (itemsToPull.length > 0) {
      const job = new TransferJob({
        direction: 'pull',
        serial,
        sourceDir,
        destDir: CACHE_DIR,
        items: itemsToPull
      });

      this.currentJob = job;

      if (onProgress) {
        job.on('progress', (data) => {
          onProgress({
            ...data,
            label: `Preparing for Finder — ${data.filesDone} of ${data.filesTotal} files`
          });
        });
      }

      const res = await job.run();
      this.currentJob = null;

      if (res.cancelled) {
        return { cancelled: true, ready: false };
      }

      if (!res.success && res.errors.length > 0) {
        const err = new Error(`Failed to prepare some files: ${res.errors.map(e => e.file).join(', ')}`);
        err.errors = res.errors;
        throw err;
      }
    }

    // Step 5: Update manifest
    for (const entry of itemsToProcess) {
      const targetLocalPath = path.join(CACHE_DIR, entry.item.name);
      if (entry.item.isDir) {
        manifest[entry.remotePath] = {
          localPath: targetLocalPath,
          size: entry.item.size || 0,
          mtimeMs: entry.item.mtimeMs,
          isDir: true
        };
        if (entry.walkFiles) {
          for (const f of entry.walkFiles) {
            manifest[f.path] = {
              localPath: path.join(targetLocalPath, f.relPath),
              size: f.size,
              mtimeMs: f.mtimeMs,
              isDir: false
            };
          }
        }
      } else {
        manifest[entry.remotePath] = {
          localPath: targetLocalPath,
          size: entry.item.size || 0,
          mtimeMs: entry.item.mtimeMs,
          isDir: false
        };
      }
    }
    saveManifest(manifest);

    return {
      cancelled: false,
      ready: true,
      localPaths: localPathsReady
    };
  }
}

module.exports = {
  CACHE_DIR,
  getCacheDir,
  wipeCache,
  isSelectionReady,
  DragCacheManager
};
