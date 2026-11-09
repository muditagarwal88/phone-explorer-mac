const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('smoke: launch, show device, select folders with Cmd-click, and copy to Mac pane', async () => {
  const fakeAdbPath = path.join(__dirname, '../fake-adb/adb');
  if (fs.existsSync(fakeAdbPath)) {
    try { fs.chmodSync(fakeAdbPath, 0o755); } catch (_) {}
  }

  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-phone-root-'));
  const localStart = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-mac-dest-'));

  try {
    // Populate fake phone folders
    const sdcard = path.join(fakeRoot, 'sdcard');
    const folderA = path.join(sdcard, 'FolderA');
    const folderB = path.join(sdcard, 'FolderB');
    fs.mkdirSync(folderA, { recursive: true });
    fs.mkdirSync(folderB, { recursive: true });
    fs.writeFileSync(path.join(folderA, 'fileA.txt'), 'content A');
    fs.writeFileSync(path.join(folderB, 'fileB.txt'), 'content B');

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../main.js')],
      env: {
        ...process.env,
        ADB_PATH: fakeAdbPath,
        FAKE_ADB_ROOT: fakeRoot,
        FAKE_ADB_STATE: 'device',
        PHONE_EXPLORER_LOCAL_START: localStart
      }
    });

    const window = await electronApp.firstWindow();

    // 1. Verify device shown
    const statusText = window.locator('#device-status-text');
    await expect(statusText).toContainText('OnePlus 9 5G', { timeout: 10000 });

    // 2. Phone pane lists folders
    const rows = window.locator('#phone-tbody tr');
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    const row0 = rows.nth(0);
    const row1 = rows.nth(1);

    // 3. Multi-select two items with Cmd-click
    await row0.click();
    await row1.click({ modifiers: ['Meta'] });

    await expect(row0).toHaveClass(/selected/);
    await expect(row1).toHaveClass(/selected/);

    // 4. Drag onto Mac pane (or transfer via action)
    const macPane = window.locator('#mac-pane');
    // Strict: the drag itself must do the copy (no button fallback)
    await row0.dragTo(macPane);

    // 5. Assert the files exist in the Mac folder
    await expect.poll(() => fs.existsSync(path.join(localStart, 'FolderA', 'fileA.txt')), { timeout: 10000 }).toBe(true);
    await expect.poll(() => fs.existsSync(path.join(localStart, 'FolderB', 'fileB.txt')), { timeout: 10000 }).toBe(true);

    await electronApp.close();
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
    fs.rmSync(localStart, { recursive: true, force: true });
  }
});
