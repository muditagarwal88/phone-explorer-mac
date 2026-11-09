const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const adb = require('../src/adb');

const fakeAdbPath = path.join(__dirname, 'fake-adb', 'adb');
if (fs.existsSync(fakeAdbPath)) {
  try {
    fs.chmodSync(fakeAdbPath, 0o755);
  } catch (_) {}
}

test('adb.findAdb respects ADB_PATH environment variable', () => {
  const orig = process.env.ADB_PATH;
  try {
    process.env.ADB_PATH = fakeAdbPath;
    assert.equal(adb.findAdb(), fakeAdbPath);
  } finally {
    process.env.ADB_PATH = orig;
  }
});

test('adb.shellQuote correctly escapes strings for remote shell', () => {
  // Simple string
  assert.equal(adb.shellQuote('sdcard'), "'sdcard'");

  // Spaces
  assert.equal(adb.shellQuote('/sdcard/My Folder/Photos'), "'/sdcard/My Folder/Photos'");

  // Single quotes
  assert.equal(adb.shellQuote("It's a sunny day"), "'It'\\''s a sunny day'");

  // Double quotes, variables, backticks
  assert.equal(adb.shellQuote('$VAR `echo hi` "hello"'), "'$VAR `echo hi` \"hello\"'");

  // Unicode
  assert.equal(adb.shellQuote('/sdcard/🎵 Music/song.mp3'), "'/sdcard/🎵 Music/song.mp3'");

  // Newlines
  assert.equal(adb.shellQuote("line1\nline2"), "'line1\nline2'");

  // Null/undefined
  assert.equal(adb.shellQuote(null), "''");
});

test('adb.parseDevices handles all device states', () => {
  // None
  const emptyOutput = 'List of devices attached\n\n';
  const noneRes = adb.parseDevices(emptyOutput);
  assert.equal(noneRes.primaryState, 'none');
  assert.equal(noneRes.devices.length, 0);

  // Device
  const deviceOutput = `List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:OnePlus_9_5G device:OnePlus9 transport_id:1
`;
  const deviceRes = adb.parseDevices(deviceOutput);
  assert.equal(deviceRes.primaryState, 'device');
  assert.equal(deviceRes.devices.length, 1);
  assert.equal(deviceRes.devices[0].serial, 'emulator-5554');
  assert.equal(deviceRes.devices[0].model, 'OnePlus_9_5G');
  assert.equal(deviceRes.devices[0].product, 'sdk_gphone64_arm64');
  assert.equal(deviceRes.devices[0].transportId, '1');

  // Unauthorized
  const unauthOutput = `List of devices attached
1234567890             unauthorized usb:1-1 transport_id:2
`;
  const unauthRes = adb.parseDevices(unauthOutput);
  assert.equal(unauthRes.primaryState, 'unauthorized');
  assert.equal(unauthRes.devices[0].serial, '1234567890');

  // Offline
  const offlineOutput = `List of devices attached
0987654321             offline transport_id:3
`;
  const offlineRes = adb.parseDevices(offlineOutput);
  assert.equal(offlineRes.primaryState, 'offline');
  assert.equal(offlineRes.devices[0].serial, '0987654321');
});

test('adb.run executes adb with argument array', async () => {
  const origAdb = process.env.ADB_PATH;
  const origState = process.env.FAKE_ADB_STATE;
  try {
    process.env.ADB_PATH = fakeAdbPath;
    process.env.FAKE_ADB_STATE = 'device';

    const { stdout } = await adb.run(['devices', '-l']);
    assert.match(stdout, /List of devices attached/);
    assert.match(stdout, /OnePlus_9_5G/);
  } finally {
    process.env.ADB_PATH = origAdb;
    process.env.FAKE_ADB_STATE = origState;
  }
});
