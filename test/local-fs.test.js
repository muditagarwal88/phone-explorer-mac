const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const localFs = require('../src/local-fs');

test('localFs.list sorts folders first, then case-insensitively', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-fs-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'zebra-folder'));
    fs.mkdirSync(path.join(tmpDir, 'Apple-folder'));
    fs.writeFileSync(path.join(tmpDir, 'banana.txt'), 'content');
    fs.writeFileSync(path.join(tmpDir, 'apple.txt'), 'apple');

    const entries = await localFs.list(tmpDir);
    assert.equal(entries.length, 4);

    // Folders first: Apple-folder, zebra-folder
    assert.equal(entries[0].name, 'Apple-folder');
    assert.equal(entries[0].isDir, true);
    assert.equal(entries[1].name, 'zebra-folder');
    assert.equal(entries[1].isDir, true);

    // Files: apple.txt, banana.txt
    assert.equal(entries[2].name, 'apple.txt');
    assert.equal(entries[2].isDir, false);
    assert.equal(entries[3].name, 'banana.txt');
    assert.equal(entries[3].isDir, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('localFs.walk traverses subdirectories and computes total bytes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-fs-walk-'));
  try {
    const sub = path.join(tmpDir, 'nested');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(tmpDir, '1.txt'), 'one');
    fs.writeFileSync(path.join(sub, '2.txt'), 'two-two');

    const walkRes = await localFs.walk(tmpDir);
    assert.equal(walkRes.files.length, 2);
    assert.equal(walkRes.totalBytes, 3 + 7);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('localFs.freeDiskSpace returns available disk bytes', async () => {
  const bytes = await localFs.freeDiskSpace(os.tmpdir());
  assert.ok(typeof bytes === 'number');
  assert.ok(bytes > 0);
});
