const path = require('path');
const adb = require('./adb');

/**
 * Regex matching standard toybox/toolbox ls -lA output:
 * drwxrwx--x 4 root sdcard_rw 3452 2026-10-06 23:37 1DM
 * -rw-rw---- 1 root sdcard_rw 123456 2026-10-06 23:37:41 My File with spaces.mp4
 * lrwxrwxrwx 1 root root 11 2026-10-06 23:37 sdcard -> /storage/emulated/0
 */
const LS_LINE_REGEX = /^([drwxlsStT\-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/;

/**
 * Parses `ls -lA` string output from Android.
 * Returns sorted entries: folders first, then case-insensitive by name.
 * Entry shape: { name, isDir, size, mtimeMs }
 */
function parseLs(output) {
  if (!output || typeof output !== 'string') return [];

  const lines = output.split('\n');
  const entries = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('total ') || line.startsWith('ls: ')) continue;

    const match = line.match(LS_LINE_REGEX);
    if (!match) continue;

    const perms = match[1];
    const size = parseInt(match[2], 10);
    const dateStr = match[3];
    let timeStr = match[4];
    let rawName = match[5];

    // Handle symlink target if present: take the link name
    let name = rawName;
    if (name.includes(' -> ')) {
      name = name.split(' -> ')[0];
    }

    // Skip '.' and '..'
    if (name === '.' || name === '..') continue;

    if (timeStr.length === 5) {
      timeStr += ':00';
    }

    let mtimeMs = new Date(`${dateStr}T${timeStr}`).getTime();
    if (isNaN(mtimeMs)) {
      mtimeMs = 0;
    }

    entries.push({
      name,
      isDir: perms.startsWith('d'),
      size: isNaN(size) ? 0 : size,
      mtimeMs
    });
  }

  // Sort: folders first, then case-insensitive name
  entries.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (cmp !== 0) return cmp;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * Lists contents of a remote directory on the phone.
 */
/**
 * `ls -lA /sdcard` on a real phone lists only the symlink itself; a trailing slash makes it list the contents.
 */
function dirArg(remoteDir) {
  const dir = remoteDir.trim() || '/sdcard';
  return dir.endsWith('/') ? dir : `${dir}/`;
}

async function list(serial, remoteDir) {
  const dir = dirArg(remoteDir);
  try {
    const { stdout } = await adb.run(['-s', serial, 'shell', 'ls', '-lA', adb.shellQuote(dir)]);
    return parseLs(stdout);
  } catch (err) {
    const errorMsg = (err.stderr || err.message || '').toLowerCase();
    if (errorMsg.includes('permission denied') || errorMsg.includes('no such file') || errorMsg.includes('not a directory')) {
      const e = new Error("Can't read this folder");
      e.code = 'UNREADABLE';
      throw e;
    }
    throw err;
  }
}

/**
 * Stats a single remote file or directory.
 */
async function stat(serial, remotePath) {
  try {
    const { stdout } = await adb.run(['-s', serial, 'shell', 'stat', '-c', '%s %Y', adb.shellQuote(remotePath)]);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      const size = parseInt(parts[0], 10);
      const mtimeSec = parseInt(parts[1], 10);
      return {
        size: isNaN(size) ? 0 : size,
        mtimeMs: isNaN(mtimeSec) ? 0 : mtimeSec * 1000
      };
    } else if (parts.length === 1 && parts[0] !== '') {
      const size = parseInt(parts[0], 10);
      return {
        size: isNaN(size) ? 0 : size,
        mtimeMs: 0
      };
    }
    throw new Error('Empty stat output');
  } catch (err) {
    throw new Error(`Failed to stat remote file ${remotePath}: ${err.message}`);
  }
}

/**
 * Recursively walks a remote directory, returning all files.
 * Returns: { files: [{ path, relPath, size, mtimeMs }], totalBytes: number }
 */
async function walk(serial, remoteDir, baseDir = remoteDir) {
  let files = [];
  let totalBytes = 0;

  const entries = await list(serial, remoteDir);
  for (const entry of entries) {
    const entryFullPath = path.posix.join(remoteDir, entry.name);
    const relPath = path.posix.relative(baseDir, entryFullPath);

    if (entry.isDir) {
      const sub = await walk(serial, entryFullPath, baseDir);
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

module.exports = {
  parseLs,
  dirArg,
  list,
  stat,
  walk
};
