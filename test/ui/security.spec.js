const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const fakeAdbPath = path.join(__dirname, '../fake-adb/adb');

async function launchWithPhoneFiles(names) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-sec-'));
  const sd = path.join(base, 'phone', 'sdcard');
  fs.mkdirSync(sd, { recursive: true });
  fs.mkdirSync(path.join(base, 'mac'));
  for (const n of names) fs.writeFileSync(path.join(sd, n), 'x');
  try { fs.chmodSync(fakeAdbPath, 0o755); } catch (_) {}
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../../main.js'), `--user-data-dir=${path.join(base, 'profile')}`],
    env: {
      ...process.env,
      ADB_PATH: fakeAdbPath,
      FAKE_ADB_ROOT: path.join(base, 'phone'),
      FAKE_ADB_STATE: 'device',
      PHONE_EXPLORER_LOCAL_START: path.join(base, 'mac'),
      PHONE_EXPLORER_PREVIEW_ROOT: path.join(base, 'previews'),
      PHONE_EXPLORER_TEST: '1'
    }
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('#device-status-text')).toContainText('OnePlus 9 5G', { timeout: 10000 });
  return { electronApp, window, base };
}

test('a phone file name containing HTML is shown as text, not turned into page elements', async () => {
  const evil = '<img id="injected" src="x">.jpg';
  const { electronApp, window, base } = await launchWithPhoneFiles([evil]);
  try {
    await expect(window.locator('#phone-tbody tr')).toHaveCount(1, { timeout: 10000 });
    await expect(window.locator('#phone-tbody tr td.col-name')).toContainText(evil);
    expect(await window.locator('#injected').count()).toBe(0);
  } finally {
    await electronApp.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('the window cannot navigate away or open new windows', async () => {
  const { electronApp, window, base } = await launchWithPhoneFiles(['a.txt']);
  try {
    const startUrl = window.url();
    await window.evaluate(() => { window.location.href = 'https://example.com/'; });
    await window.waitForTimeout(500);
    expect(window.url()).toBe(startUrl);
    expect(await window.evaluate(() => window.open('https://example.com/') === null)).toBe(true);
    expect(electronApp.windows()).toHaveLength(1);
  } finally {
    await electronApp.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a request with a path-escaping name is refused by the main process', async () => {
  const { electronApp, window, base } = await launchWithPhoneFiles(['a.txt']);
  try {
    await expect(window.locator('#phone-tbody tr')).toHaveCount(1, { timeout: 10000 });
    const err = await window.evaluate((dest) => window.api.startTransfer({
      direction: 'pull', sourceDir: '/sdcard', destDir: dest, items: [{ name: '../../escaped.txt', isDir: false }]
    }).then(() => 'accepted', (e) => e.message), path.join(base, 'mac'));
    expect(err).toContain('Rejected');
    expect(fs.existsSync(path.join(base, 'escaped.txt'))).toBe(false);
  } finally {
    await electronApp.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
