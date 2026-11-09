const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const phoneFs = require('../src/phone-fs');

const fakeAdbPath = path.join(__dirname, 'fake-adb', 'adb');

test('phoneFs.parseLs parses fixture and handles all edge cases', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'ls-toybox.txt');
  const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

  const entries = phoneFs.parseLs(fixtureContent);

  // Check count (skipping total 48 and .)
  assert.equal(entries.length, 7);

  // Folders first: 1DM, DCIM
  assert.equal(entries[0].name, '1DM');
  assert.equal(entries[0].isDir, true);
  assert.equal(entries[0].size, 3452);
  assert.equal(entries[0].mtimeMs, new Date('2026-10-06T23:37:00').getTime());

  assert.equal(entries[1].name, 'DCIM');
  assert.equal(entries[1].isDir, true);

  // Files: case-insensitive sorted
  // localeCompare order (as in Finder): symbols and emoji sort before letters
  const fileNames = entries.slice(2).map(e => e.name);
  assert.deepEqual(fileNames, [
    '.hidden_file',
    '🎵 song.mp3',
    'My File with spaces.mp4',
    'Normal.txt',
    'sdcard'
  ]);

  // Check seconds parsed
  const spacedFile = entries.find(e => e.name === 'My File with spaces.mp4');
  assert.equal(spacedFile.mtimeMs, new Date('2026-10-06T23:37:41').getTime());
  assert.equal(spacedFile.size, 123456);
  assert.equal(spacedFile.isDir, false);

  // Check symlink: name is 'sdcard', not target '/storage/emulated/0'
  const symlink = entries.find(e => e.name === 'sdcard');
  assert.ok(symlink);
  assert.equal(symlink.name, 'sdcard');
});

test('phoneFs.list and walk work against fake-adb', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-fs-test-'));
  const origAdb = process.env.ADB_PATH;
  const origRoot = process.env.FAKE_ADB_ROOT;

  try {
    process.env.ADB_PATH = fakeAdbPath;
    process.env.FAKE_ADB_ROOT = tmpRoot;

    // Set up virtual phone tree
    const sdcardDir = path.join(tmpRoot, 'sdcard');
    const subDir = path.join(sdcardDir, 'SubFolder');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(sdcardDir, 'a.txt'), 'hello a');
    fs.writeFileSync(path.join(subDir, 'b.txt'), 'hello b world');

    const listEntries = await phoneFs.list('fake-serial', '/sdcard');
    assert.equal(listEntries.length, 2);
    assert.equal(listEntries[0].name, 'SubFolder');
    assert.equal(listEntries[0].isDir, true);
    assert.equal(listEntries[1].name, 'a.txt');
    assert.equal(listEntries[1].isDir, false);

    const walkResult = await phoneFs.walk('fake-serial', '/sdcard');
    assert.equal(walkResult.files.length, 2);
    assert.equal(walkResult.totalBytes, 'hello a'.length + 'hello b world'.length);
  } finally {
    process.env.ADB_PATH = origAdb;
    process.env.FAKE_ADB_ROOT = origRoot;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('phoneFs.dirArg adds a trailing slash so symlinked folders like /sdcard list their contents', () => {
  assert.equal(phoneFs.dirArg('/sdcard'), '/sdcard/');
  assert.equal(phoneFs.dirArg('/sdcard/'), '/sdcard/');
  assert.equal(phoneFs.dirArg('/sdcard/Download'), '/sdcard/Download/');
  assert.equal(phoneFs.dirArg('  '), '/sdcard/');
});
