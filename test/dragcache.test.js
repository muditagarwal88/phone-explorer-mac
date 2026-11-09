const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const dragcache = require('../src/dragcache');
const localFs = require('../src/local-fs');

const fakeAdbPath = path.join(__dirname, 'fake-adb', 'adb');

test('dragcache: prepare caches selection and reuses unchanged files', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dragcache-root-'));
  const origAdb = process.env.ADB_PATH;
  const origRoot = process.env.FAKE_ADB_ROOT;

  try {
    process.env.ADB_PATH = fakeAdbPath;
    process.env.FAKE_ADB_ROOT = tmpRoot;

    dragcache.wipeCache();

    // Create virtual phone items
    const sdcard = path.join(tmpRoot, 'sdcard');
    fs.mkdirSync(sdcard, { recursive: true });
    const imgFile = path.join(sdcard, 'photo.jpg');
    fs.writeFileSync(imgFile, 'photo content data');
    const stat = fs.statSync(imgFile);

    const manager = new dragcache.DragCacheManager();
    const items = [{ name: 'photo.jpg', isDir: false, size: stat.size, mtimeMs: stat.mtimeMs }];

    // First prepare
    const res1 = await manager.prepare('fake-serial', '/sdcard', items);
    assert.equal(res1.ready, true);
    assert.ok(fs.existsSync(path.join(dragcache.CACHE_DIR, 'photo.jpg')));

    // Check isSelectionReady
    const isReady = await dragcache.isSelectionReady('fake-serial', '/sdcard', items);
    assert.equal(isReady, true);

    // Second prepare reuses cached files
    const res2 = await manager.prepare('fake-serial', '/sdcard', items);
    assert.equal(res2.ready, true);
  } finally {
    process.env.ADB_PATH = origAdb;
    process.env.FAKE_ADB_ROOT = origRoot;
    dragcache.wipeCache();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('dragcache: refuses when free space is less than selection size + 1 GB', async () => {
  const manager = new dragcache.DragCacheManager();
  const origFreeSpace = localFs.freeDiskSpace;

  try {
    // Mock free disk space to 500 MB
    localFs.freeDiskSpace = async () => 500 * 1024 * 1024;

    // Selection size 100 MB -> requires 1.1 GB -> must fail
    await assert.rejects(async () => {
      await manager.prepare('fake-serial', '/sdcard', [
        { name: 'big.zip', isDir: false, size: 100 * 1024 * 1024, mtimeMs: 1000 }
      ]);
    }, /Not enough free disk space/);
  } finally {
    localFs.freeDiskSpace = origFreeSpace;
  }
});
