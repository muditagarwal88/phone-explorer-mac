const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const adb = require('./adb');
const phoneFs = require('./phone-fs');
const localFs = require('./local-fs');

/**
 * Resolves a non-clashing name in a local directory.
 * If target exists: name (1).ext, name (2).ext
 */
function resolveClashLocal(destDir, name, isDir) {
  let targetPath = path.join(destDir, name);
  if (!fs.existsSync(targetPath)) {
    return name;
  }

  let ext = '';
  let base = name;
  if (!isDir && path.extname(name)) {
    ext = path.extname(name);
    base = path.basename(name, ext);
  }

  let counter = 1;
  while (true) {
    const candidateName = `${base} (${counter})${ext}`;
    const candidatePath = path.join(destDir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return candidateName;
    }
    counter++;
  }
}

/**
 * Resolves a non-clashing name in a remote phone directory.
 */
async function resolveClashRemote(serial, destDir, name, isDir) {
  async function existsRemote(remotePath) {
    try {
      await phoneFs.stat(serial, remotePath);
      return true;
    } catch (_) {
      return false;
    }
  }

  const targetPath = path.posix.join(destDir, name);
  if (!(await existsRemote(targetPath))) {
    return name;
  }

  let ext = '';
  let base = name;
  if (!isDir && path.posix.extname(name)) {
    ext = path.posix.extname(name);
    base = path.posix.basename(name, ext);
  }

  let counter = 1;
  while (true) {
    const candidateName = `${base} (${counter})${ext}`;
    const candidatePath = path.posix.join(destDir, candidateName);
    if (!(await existsRemote(candidatePath))) {
      return candidateName;
    }
    counter++;
  }
}

class TransferJob extends EventEmitter {
  constructor(options) {
    super();
    this.direction = options.direction; // 'pull' or 'push'
    this.serial = options.serial;
    this.sourceDir = options.sourceDir;
    this.destDir = options.destDir;
    this.items = options.items || []; // Array of { name, isDir, size } or string names

    this.cancelled = false;
    this.activeProc = null;
    this.currentDest = null;
    this.errors = [];
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;

    if (this.activeProc) {
      try {
        this.activeProc.kill('SIGTERM');
      } catch (_) {}
    }

    if (this.currentDest) {
      this._cleanupPartial(this.currentDest);
    }

    this.emit('cancelled');
  }

  _cleanupPartial(destPath) {
    if (!destPath) return;
    if (this.direction === 'pull') {
      try {
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
      } catch (_) {}
    } else if (this.direction === 'push') {
      adb.run(['-s', this.serial, 'shell', 'rm', '-f', adb.shellQuote(destPath)]).catch(() => {});
    }
  }

  async run() {
    const fileQueue = [];
    let bytesTotal = 0;

    // Phase 1: Planning and recursive walk
    for (const rawItem of this.items) {
      if (this.cancelled) break;

      const item = typeof rawItem === 'string'
        ? { name: path.basename(rawItem), isDir: false, size: 0, path: rawItem }
        : rawItem;

      if (this.direction === 'pull') {
        const remoteItemPath = item.path || path.posix.join(this.sourceDir, item.name);
        const resolvedName = resolveClashLocal(this.destDir, item.name, item.isDir);
        const targetDest = path.join(this.destDir, resolvedName);

        if (item.isDir) {
          const walkResult = await phoneFs.walk(this.serial, remoteItemPath);
          for (const f of walkResult.files) {
            const destFilePath = path.join(targetDest, f.relPath);
            fileQueue.push({
              src: f.path,
              dest: destFilePath,
              size: f.size,
              displayName: path.join(resolvedName, f.relPath)
            });
            bytesTotal += f.size;
          }
        } else {
          fileQueue.push({
            src: remoteItemPath,
            dest: targetDest,
            size: item.size || 0,
            displayName: resolvedName
          });
          bytesTotal += item.size || 0;
        }
      } else if (this.direction === 'push') {
        const localItemPath = item.path || path.join(this.sourceDir, item.name);
        const resolvedName = await resolveClashRemote(this.serial, this.destDir, item.name, item.isDir);
        const targetDest = path.posix.join(this.destDir, resolvedName);

        if (item.isDir) {
          const walkResult = await localFs.walk(localItemPath);
          for (const f of walkResult.files) {
            const posixRel = f.relPath.split(path.sep).join('/');
            const destFilePath = path.posix.join(targetDest, posixRel);
            fileQueue.push({
              src: f.path,
              dest: destFilePath,
              size: f.size,
              displayName: path.posix.join(resolvedName, posixRel)
            });
            bytesTotal += f.size;
          }
        } else {
          fileQueue.push({
            src: localItemPath,
            dest: targetDest,
            size: item.size || 0,
            displayName: resolvedName
          });
          bytesTotal += item.size || 0;
        }
      }
    }

    if (this.cancelled) {
      return { cancelled: true, filesDone: 0, bytesDone: 0 };
    }

    const filesTotal = fileQueue.length;
    let filesDone = 0;
    let completedBytes = 0;
    const startTime = Date.now();

    this.emit('progress', {
      label: filesTotal > 0 ? `Starting (${filesTotal} files)` : 'Nothing to copy',
      filesDone: 0,
      filesTotal,
      bytesDone: 0,
      bytesTotal,
      speed: 0
    });

    // Phase 2: One file at a time
    for (const file of fileQueue) {
      if (this.cancelled) break;

      this.currentDest = file.dest;

      if (this.direction === 'pull') {
        fs.mkdirSync(path.dirname(file.dest), { recursive: true });
      } else if (this.direction === 'push') {
        await adb.run(['-s', this.serial, 'shell', 'mkdir', '-p', adb.shellQuote(path.posix.dirname(file.dest))]);
      }

      // Polling for in-flight progress
      let currentInFlightBytes = 0;
      const pollTimer = setInterval(async () => {
        if (this.cancelled) return;
        try {
          if (this.direction === 'pull') {
            if (fs.existsSync(file.dest)) {
              const s = fs.statSync(file.dest);
              currentInFlightBytes = Math.min(s.size, file.size);
            }
          } else if (this.direction === 'push') {
            const statResult = await phoneFs.stat(this.serial, file.dest).catch(() => null);
            if (statResult) {
              currentInFlightBytes = Math.min(statResult.size, file.size);
            }
          }

          const elapsedSec = (Date.now() - startTime) / 1000;
          const totalBytesSoFar = completedBytes + currentInFlightBytes;
          const speed = elapsedSec > 0 ? totalBytesSoFar / elapsedSec : 0;

          this.emit('progress', {
            label: `${file.displayName} (${filesDone + 1}/${filesTotal})`,
            filesDone,
            filesTotal,
            bytesDone: totalBytesSoFar,
            bytesTotal,
            speed
          });
        } catch (_) {}
      }, 200);

      // Execute transfer for this single file
      let transferError = null;
      try {
        await new Promise((resolve, reject) => {
          let proc;
          if (this.direction === 'pull') {
            proc = adb.spawnAdb(['-s', this.serial, 'pull', '-a', file.src, file.dest]);
          } else {
            proc = adb.spawnAdb(['-s', this.serial, 'push', file.src, file.dest]);
          }
          this.activeProc = proc;

          proc.on('error', err => reject(err));
          proc.on('close', code => {
            if (this.cancelled) {
              return reject(new Error('Transfer cancelled'));
            }
            if (code !== 0) {
              return reject(new Error(`adb exited with code ${code}`));
            }
            resolve();
          });
        });
      } catch (err) {
        transferError = err;
      } finally {
        clearInterval(pollTimer);
        this.activeProc = null;
      }

      if (this.cancelled) {
        this._cleanupPartial(file.dest);
        break;
      }

      if (transferError) {
        this._cleanupPartial(file.dest);
        this.errors.push({ file: file.displayName, error: transferError.message });
      } else {
        filesDone++;
        completedBytes += file.size;
        this.currentDest = null;
      }

      const elapsedSec = (Date.now() - startTime) / 1000;
      const speed = elapsedSec > 0 ? completedBytes / elapsedSec : 0;

      this.emit('progress', {
        label: `${file.displayName} (${filesDone}/${filesTotal})`,
        filesDone,
        filesTotal,
        bytesDone: completedBytes,
        bytesTotal,
        speed
      });
    }

    if (this.cancelled) {
      return {
        cancelled: true,
        filesDone,
        filesTotal,
        bytesDone: completedBytes,
        bytesTotal,
        errors: this.errors
      };
    }

    const result = {
      cancelled: false,
      success: this.errors.length === 0,
      filesDone,
      filesTotal,
      bytesDone: completedBytes,
      bytesTotal,
      errors: this.errors
    };

    this.emit('done', result);
    return result;
  }
}

module.exports = {
  resolveClashLocal,
  resolveClashRemote,
  TransferJob
};
