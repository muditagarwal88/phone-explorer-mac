const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { TransferJob } = require('../src/transfer');

const fakeAdbPath = path.join(__dirname, 'fake-adb', 'adb');

function sha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

test('transfer: nested folder round trip compared by SHA-256', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-root-'));
  const localDest = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-local-'));

  const origAdb = process.env.ADB_PATH;
  const origRoot = process.env.FAKE_ADB_ROOT;
  const origDelay = process.env.FAKE_ADB_DELAY_MS;

  try {
    process.env.ADB_PATH = fakeAdbPath;
    process.env.FAKE_ADB_ROOT = tmpRoot;
    process.env.FAKE_ADB_DELAY_MS = '0';

    // 1. Create nested structure on virtual phone
    const phoneSdcard = path.join(tmpRoot, 'sdcard');
    const sourceFolder = path.join(phoneSdcard, 'NestedDir');
    const subFolder = path.join(sourceFolder, 'sub');
    fs.mkdirSync(subFolder, { recursive: true });

    const file1 = path.join(sourceFolder, 'file1.txt');
    const file2 = path.join(subFolder, 'file2.bin');
    fs.writeFileSync(file1, 'Hello phone world text file!');
    fs.writeFileSync(file2, crypto.randomBytes(4096));

    const hash1 = sha256(file1);
    const hash2 = sha256(file2);

    // 2. Pull from phone to Mac
    const pullJob = new TransferJob({
      direction: 'pull',
      serial: 'fake-serial',
      sourceDir: '/sdcard',
      destDir: localDest,
      items: [{ name: 'NestedDir', isDir: true, size: 0 }]
    });

    const pullRes = await pullJob.run();
    assert.equal(pullRes.cancelled, false);
    assert.equal(pullRes.success, true);
    assert.equal(pullRes.filesDone, 2);

    // Verify pulled files match SHA-256
    const pulledFile1 = path.join(localDest, 'NestedDir', 'file1.txt');
    const pulledFile2 = path.join(localDest, 'NestedDir', 'sub', 'file2.bin');
    assert.ok(fs.existsSync(pulledFile1));
    assert.ok(fs.existsSync(pulledFile2));
    assert.equal(sha256(pulledFile1), hash1);
    assert.equal(sha256(pulledFile2), hash2);

    // 3. Push back to phone under /sdcard/PushedDir
    const pushJob = new TransferJob({
      direction: 'push',
      serial: 'fake-serial',
      sourceDir: localDest,
      destDir: '/sdcard',
      items: [{ name: 'NestedDir', isDir: true, size: 0 }]
    });

    const pushRes = await pushJob.run();
    assert.equal(pushRes.cancelled, false);
    assert.equal(pushRes.success, true);
  } finally {
    process.env.ADB_PATH = origAdb;
    process.env.FAKE_ADB_ROOT = origRoot;
    process.env.FAKE_ADB_DELAY_MS = origDelay;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(localDest, { recursive: true, force: true });
  }
});

test('transfer: cancel mid-file leaves no partial destination file', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-root-'));
  const localDest = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-local-'));

  const origAdb = process.env.ADB_PATH;
  const origRoot = process.env.FAKE_ADB_ROOT;
  const origDelay = process.env.FAKE_ADB_DELAY_MS;

  try {
    process.env.ADB_PATH = fakeAdbPath;
    process.env.FAKE_ADB_ROOT = tmpRoot;
    process.env.FAKE_ADB_DELAY_MS = '600'; // Delay to allow cancel mid-file

    const phoneSdcard = path.join(tmpRoot, 'sdcard');
    fs.mkdirSync(phoneSdcard, { recursive: true });
    const largeFile = path.join(phoneSdcard, 'large.bin');
    fs.writeFileSync(largeFile, crypto.randomBytes(8192));

    const job = new TransferJob({
      direction: 'pull',
      serial: 'fake-serial',
      sourceDir: '/sdcard',
      destDir: localDest,
      items: [{ name: 'large.bin', isDir: false, size: 8192 }]
    });

    const runPromise = job.run();

    // Wait slightly so fake-adb starts copying and writes the first half
    await new Promise(r => setTimeout(r, 150));

    job.cancel();
    const result = await runPromise;

    assert.equal(result.cancelled, true);

    // Assert partial file does not exist on local disk
    const destPartial = path.join(localDest, 'large.bin');
    assert.equal(fs.existsSync(destPartial), false, 'Partial file should have been deleted');
  } finally {
    process.env.ADB_PATH = origAdb;
    process.env.FAKE_ADB_ROOT = origRoot;
    process.env.FAKE_ADB_DELAY_MS = origDelay;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(localDest, { recursive: true, force: true });
  }
});

test('transfer: name clash resolves to name (1).ext and name (2).ext without overwriting', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-root-'));
  const localDest = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-local-'));

  const origAdb = process.env.ADB_PATH;
  const origRoot = process.env.FAKE_ADB_ROOT;
  const origDelay = process.env.FAKE_ADB_DELAY_MS;

  try {
    process.env.ADB_PATH = fakeAdbPath;
    process.env.FAKE_ADB_ROOT = tmpRoot;
    process.env.FAKE_ADB_DELAY_MS = '0';

    const phoneSdcard = path.join(tmpRoot, 'sdcard');
    fs.mkdirSync(phoneSdcard, { recursive: true });
    fs.writeFileSync(path.join(phoneSdcard, 'doc.txt'), 'phone content');

    // Create an existing doc.txt on local Mac
    const originalLocalDoc = path.join(localDest, 'doc.txt');
    fs.writeFileSync(originalLocalDoc, 'original mac content');

    // First pull
    const job1 = new TransferJob({
      direction: 'pull',
      serial: 'fake-serial',
      sourceDir: '/sdcard',
      destDir: localDest,
      items: [{ name: 'doc.txt', isDir: false, size: 13 }]
    });
    await job1.run();

    // Original file must be preserved
    assert.equal(fs.readFileSync(originalLocalDoc, 'utf8'), 'original mac content');

    // New file must be doc (1).txt
    const clash1 = path.join(localDest, 'doc (1).txt');
    assert.ok(fs.existsSync(clash1));
    assert.equal(fs.readFileSync(clash1, 'utf8'), 'phone content');

    // Second pull
    const job2 = new TransferJob({
      direction: 'pull',
      serial: 'fake-serial',
      sourceDir: '/sdcard',
      destDir: localDest,
      items: [{ name: 'doc.txt', isDir: false, size: 13 }]
    });
    await job2.run();

    // Third file must be doc (2).txt
    const clash2 = path.join(localDest, 'doc (2).txt');
    assert.ok(fs.existsSync(clash2));
    assert.equal(fs.readFileSync(clash2, 'utf8'), 'phone content');
  } finally {
    process.env.ADB_PATH = origAdb;
    process.env.FAKE_ADB_ROOT = origRoot;
    process.env.FAKE_ADB_DELAY_MS = origDelay;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(localDest, { recursive: true, force: true });
  }
});
