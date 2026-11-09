const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Only these types open with a double-click: photos, videos, music and documents. Everything else
// (apps, scripts, installers, files with no extension) is shown in Finder instead, because files from a
// phone are untrusted and an allowlist can't miss a dangerous type the way a blocklist can.
const SAFE_TO_OPEN = new Set([
  // photos
  '.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.dng',
  // video
  '.mp4', '.m4v', '.mov', '.3gp', '.mkv', '.webm', '.avi', '.mpg', '.mpeg',
  // music and voice notes
  '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.amr', '.aif', '.aiff',
  // documents
  '.pdf', '.txt', '.md', '.csv', '.rtf', '.log', '.epub',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key'
]);

function previewRoot() {
  return process.env.PHONE_EXPLORER_PREVIEW_ROOT || path.join(os.tmpdir(), 'phone-explorer-preview');
}

function isSafeToOpen(fileName) {
  return SAFE_TO_OPEN.has(path.extname(String(fileName)).toLowerCase());
}

/** Make a preview copy plain data: a regular file with no execute bits. Returns false if it isn't a regular file. */
function makeInert(filePath) {
  const st = fs.lstatSync(filePath);
  if (!st.isFile()) return false;
  fs.chmodSync(filePath, 0o644);
  return true;
}

/** A fresh, empty folder for one preview, so two files with the same name never collide. */
function newPreviewDir() {
  const dir = path.join(previewRoot(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Delete every preview copy (used on app start and quit). */
function wipe() {
  removeDir(previewRoot());
}

/** Delete preview copies older than maxAgeMs. Returns how many were removed. */
function sweep(maxAgeMs, now = Date.now()) {
  let removed = 0;
  let names;
  try {
    names = fs.readdirSync(previewRoot());
  } catch (_) {
    return 0;
  }
  for (const name of names) {
    const dir = path.join(previewRoot(), name);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) {
        removeDir(dir);
        removed++;
      }
    } catch (_) { /* already gone */ }
  }
  return removed;
}

module.exports = { previewRoot, isSafeToOpen, makeInert, newPreviewDir, removeDir, wipe, sweep };
