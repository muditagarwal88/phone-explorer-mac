const fs = require('fs');
const path = require('path');

/**
 * Lists contents of a local directory on the Mac.
 * Returns sorted entries: folders first, then case-insensitive by name.
 * Entry shape: { name, isDir, size, mtimeMs }
 */
async function list(dir) {
  try {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    const entries = [];

    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name);
      try {
        const stats = await fs.promises.stat(fullPath);
        entries.push({
          name: dirent.name,
          isDir: dirent.isDirectory(),
          size: dirent.isDirectory() ? 0 : stats.size,
          mtimeMs: stats.mtimeMs
        });
      } catch (_) {
        // If broken symlink or permission issue on a single file, still report best-effort
        entries.push({
          name: dirent.name,
          isDir: dirent.isDirectory(),
          size: 0,
          mtimeMs: 0
        });
      }
    }

    entries.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name);
    });

    return entries;
  } catch (err) {
    const errorMsg = (err.message || '').toLowerCase();
    if (errorMsg.includes('permission denied') || errorMsg.includes('eacces') || errorMsg.includes('enoent') || errorMsg.includes('enotdir')) {
      const e = new Error("Can't read this folder");
      e.code = 'UNREADABLE';
      throw e;
    }
    throw err;
  }
}

/**
 * Stats a local path.
 */
async function stat(localPath) {
  const stats = await fs.promises.stat(localPath);
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    isDir: stats.isDirectory()
  };
}

/**
 * Recursively walks a local directory, returning all files.
 * Returns: { files: [{ path, relPath, size, mtimeMs }], totalBytes: number }
 */
async function walk(localDir, baseDir = localDir) {
  let files = [];
  let totalBytes = 0;

  const entries = await list(localDir);
  for (const entry of entries) {
    const entryFullPath = path.join(localDir, entry.name);
    const relPath = path.relative(baseDir, entryFullPath);

    if (entry.isDir) {
      const sub = await walk(entryFullPath, baseDir);
      files = files.concat(sub.files);
      totalBytes += sub.totalBytes;
    } else {
      files.push({
        path: entryFullPath,
        relPath,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        isDir: false
      });
      totalBytes += entry.size;
    }
  }

  return { files, totalBytes };
}

/**
 * Checks available free disk space in bytes for the volume containing the given directory.
 */
async function freeDiskSpace(targetDir) {
  try {
    const dir = fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir);
    if (fs.promises.statfs) {
      const stats = await fs.promises.statfs(dir);
      return stats.bavail * stats.bsize;
    }
    // Fallback: assume plentiful disk space if statfs is unavailable
    return Number.MAX_SAFE_INTEGER;
  } catch (_) {
    return Number.MAX_SAFE_INTEGER;
  }
}

module.exports = {
  list,
  stat,
  walk,
  freeDiskSpace
};
