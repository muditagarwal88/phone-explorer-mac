const path = require('node:path');

// Checks on what the window sends to the main process. The window shows names that come from the phone,
// so treat its requests as untrusted: wrong shapes are rejected instead of being passed to adb or the disk.

function isSafeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 1024 &&
    name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\0');
}

function isPathString(p) {
  return typeof p === 'string' && p.length <= 4096 && !p.includes('\0');
}

function fail(message) {
  const err = new Error(`Rejected request: ${message}`);
  err.code = 'BAD_REQUEST';
  throw err;
}

/** One file or folder chosen in a pane. `path` is only allowed for Mac files dropped from Finder. */
function checkItem(item, { allowLocalPath }) {
  if (!item || typeof item !== 'object') fail('item is not an object');
  if (!isSafeName(item.name)) fail('bad item name');
  if (item.isDir !== undefined && typeof item.isDir !== 'boolean') fail('bad isDir');
  if (item.path !== undefined) {
    if (!allowLocalPath) fail('item path not allowed here');
    if (!isPathString(item.path) || !path.isAbsolute(item.path)) fail('item path must be absolute');
    if (path.basename(item.path) !== item.name) fail('item path does not match its name');
  }
  return { name: item.name, isDir: item.isDir === true, size: Number(item.size) || 0, mtimeMs: Number(item.mtimeMs) || 0,
    ...(item.path !== undefined ? { path: item.path } : {}) };
}

function checkItems(items, opts) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100000) fail('items must be a non-empty list');
  return items.map((item) => checkItem(item, opts));
}

/** transfer:start. Returns a clean copy; the serial always comes from the main process, never the window. */
function checkTransfer(options) {
  if (!options || typeof options !== 'object') fail('options missing');
  const { direction, sourceDir, destDir } = options;
  if (direction !== 'pull' && direction !== 'push') fail('direction must be pull or push');
  if (!isPathString(sourceDir) || !isPathString(destDir)) fail('bad folder');
  if (!path.isAbsolute(destDir)) fail('destination must be absolute');
  if (direction === 'pull' && !path.posix.isAbsolute(sourceDir)) fail('phone folder must be absolute');
  // Pushes come from the Mac pane (sourceDir + name) or from Finder (absolute item.path, empty sourceDir)
  if (direction === 'push' && sourceDir !== '' && !path.isAbsolute(sourceDir)) fail('Mac folder must be absolute');
  const items = checkItems(options.items, { allowLocalPath: direction === 'push' });
  if (direction === 'push' && sourceDir === '' && items.some((i) => !i.path)) fail('Finder items need a path');
  return { direction, sourceDir, destDir, items };
}

/** dragcache:prepare and preview:phone-file: a phone folder plus phone entries (no local paths). */
function checkPhoneSelection(sourceDir, items) {
  if (!isPathString(sourceDir) || !path.posix.isAbsolute(sourceDir)) fail('phone folder must be absolute');
  return checkItems(items, { allowLocalPath: false });
}

/** drag:start-native: only files the app itself copied into its Finder drag cache may be dragged out. */
function checkCachedPaths(localPaths, cacheDir) {
  if (!Array.isArray(localPaths) || localPaths.length === 0) fail('no files to drag');
  const root = path.resolve(cacheDir) + path.sep;
  for (const p of localPaths) {
    if (!isPathString(p) || !path.resolve(p).startsWith(root)) fail('file is not in the drag cache');
  }
  return localPaths.slice();
}

module.exports = { isSafeName, checkTransfer, checkPhoneSelection, checkCachedPaths };
