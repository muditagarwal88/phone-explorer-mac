const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Files that macOS would run (or install) when opened. Files from a phone are untrusted, so these are
// shown in Finder instead of being opened automatically.
const RISKY_EXTENSIONS = new Set([
  '.command', '.app', '.pkg', '.mpkg', '.dmg', '.sh', '.zsh', '.bash', '.csh', '.ksh', '.tool',
  '.terminal', '.workflow', '.action', '.scpt', '.scptd', '.applescript', '.jar', '.pl', '.py', '.rb',
  '.php', '.js', '.jse', '.vbs', '.wsf', '.exe', '.bat', '.cmd', '.msi', '.com', '.scr', '.ps1',
  '.webloc', '.url', '.inetloc', '.fileloc', '.prefpane', '.saver', '.plugin', '.kext', '.service'
]);

function previewRoot() {
  return process.env.PHONE_EXPLORER_PREVIEW_ROOT || path.join(os.tmpdir(), 'phone-explorer-preview');
}

function isRiskyToOpen(fileName) {
  return RISKY_EXTENSIONS.has(path.extname(String(fileName)).toLowerCase());
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

module.exports = { previewRoot, isRiskyToOpen, newPreviewDir, removeDir, wipe, sweep };
