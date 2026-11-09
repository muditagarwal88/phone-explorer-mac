const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const fakeAdbPath = path.join(__dirname, '../fake-adb/adb');

async function launch({ fakeRoot, localStart, previewRoot }) {
  try { fs.chmodSync(fakeAdbPath, 0o755); } catch (_) {}
  // Own profile folder per launch, so saved settings (e.g. the preview checkbox) never leak between tests
  const userData = path.join(path.dirname(fakeRoot), 'profile');
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../../main.js'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ADB_PATH: fakeAdbPath,
      FAKE_ADB_ROOT: fakeRoot,
      FAKE_ADB_STATE: 'device',
      PHONE_EXPLORER_LOCAL_START: localStart,
      PHONE_EXPLORER_PREVIEW_ROOT: previewRoot,
      PHONE_EXPLORER_TEST: '1'
    }
  });
  const window = await electronApp.firstWindow();
  await expect(window.locator('#device-status-text')).toContainText('OnePlus 9 5G', { timeout: 10000 });
  return { electronApp, window };
}

function makeDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ui-'));
  const fakeRoot = path.join(base, 'phone');
  const localStart = path.join(base, 'mac');
  const previewRoot = path.join(base, 'previews');
  fs.mkdirSync(path.join(fakeRoot, 'sdcard'), { recursive: true });
  fs.mkdirSync(localStart, { recursive: true });
  return { base, fakeRoot, localStart, previewRoot };
}

function previewCopies(previewRoot) {
  if (!fs.existsSync(previewRoot)) return [];
  return fs.readdirSync(previewRoot).flatMap((d) =>
    fs.readdirSync(path.join(previewRoot, d)).map((f) => path.join(previewRoot, d, f))
  );
}

test('double-click on a phone file copies it to a temp folder, and the copy is deleted on quit', async () => {
  const { base, fakeRoot, localStart, previewRoot } = makeDirs();
  try {
    fs.writeFileSync(path.join(fakeRoot, 'sdcard', 'hello.txt'), 'hello from the phone');
    const { electronApp, window } = await launch({ fakeRoot, localStart, previewRoot });

    const row = window.locator('#phone-tbody tr', { hasText: 'hello.txt' });
    await expect(row).toHaveCount(1, { timeout: 10000 });
    await row.dblclick();

    await expect(window.locator('#transfer-label')).toContainText('Opened hello.txt', { timeout: 10000 });
    const copies = previewCopies(previewRoot);
    expect(copies).toHaveLength(1);
    expect(path.basename(copies[0])).toBe('hello.txt');
    expect(fs.readFileSync(copies[0], 'utf8')).toBe('hello from the phone');
    // The phone file is untouched (copy only)
    expect(fs.readFileSync(path.join(fakeRoot, 'sdcard', 'hello.txt'), 'utf8')).toBe('hello from the phone');

    await electronApp.close();
    expect(fs.existsSync(previewRoot)).toBe(false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('double-click on a file that can run code is revealed, not opened', async () => {
  const { base, fakeRoot, localStart, previewRoot } = makeDirs();
  try {
    fs.writeFileSync(path.join(fakeRoot, 'sdcard', 'run.command'), 'echo hi');
    const { electronApp, window } = await launch({ fakeRoot, localStart, previewRoot });

    await window.locator('#phone-tbody tr', { hasText: 'run.command' }).dblclick();
    await expect(window.locator('#transfer-label')).toContainText('shown in Finder instead of opened', { timeout: 10000 });

    await electronApp.close();
    expect(fs.existsSync(previewRoot)).toBe(false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('with "Preview on double-click" off, a file double-click copies nothing', async () => {
  const { base, fakeRoot, localStart, previewRoot } = makeDirs();
  try {
    fs.writeFileSync(path.join(fakeRoot, 'sdcard', 'hello.txt'), 'x');
    const { electronApp, window } = await launch({ fakeRoot, localStart, previewRoot });

    await window.locator('#chk-preview').uncheck();
    await window.locator('#phone-tbody tr', { hasText: 'hello.txt' }).dblclick();
    await window.waitForTimeout(500);
    expect(previewCopies(previewRoot)).toHaveLength(0);

    await electronApp.close();
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('after "Prepare for Finder", dragging the selection starts a native drag with the copied files', async () => {
  const { base, fakeRoot, localStart, previewRoot } = makeDirs();
  try {
    const sd = path.join(fakeRoot, 'sdcard');
    fs.writeFileSync(path.join(sd, 'one.txt'), 'one');
    fs.writeFileSync(path.join(sd, 'two.txt'), 'two');
    const { electronApp, window } = await launch({ fakeRoot, localStart, previewRoot });

    const rows = window.locator('#phone-tbody tr');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Meta'] });

    await window.locator('#btn-prepare-finder').click();
    await expect(window.locator('#transfer-label')).toContainText('Ready', { timeout: 10000 });

    // Real mouse drags cannot start an OS-level drag in a test, so dispatch dragstart on a selected row
    await rows.nth(0).dispatchEvent('dragstart', { dataTransfer: await window.evaluateHandle(() => new DataTransfer()) });

    await expect.poll(
      () => electronApp.evaluate(() => (global.__dragCalls || []).length),
      { timeout: 5000 }
    ).toBe(1);
    const paths = await electronApp.evaluate(() => global.__dragCalls[0]);
    expect(paths.map((p) => path.basename(p)).sort()).toEqual(['one.txt', 'two.txt']);
    for (const p of paths) expect(fs.existsSync(p)).toBe(true);

    // The drag icon must be a real image, otherwise macOS shows no drag preview
    expect(await electronApp.evaluate(() => global.__dragIconEmpty)).toBe(false);

    await electronApp.close();
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('without "Prepare for Finder", dragging does not start a native drag', async () => {
  const { base, fakeRoot, localStart, previewRoot } = makeDirs();
  try {
    fs.writeFileSync(path.join(fakeRoot, 'sdcard', 'one.txt'), 'one');
    const { electronApp, window } = await launch({ fakeRoot, localStart, previewRoot });

    const row = window.locator('#phone-tbody tr').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();
    await row.dispatchEvent('dragstart', { dataTransfer: await window.evaluateHandle(() => new DataTransfer()) });
    await window.waitForTimeout(300);
    expect(await electronApp.evaluate(() => (global.__dragCalls || []).length)).toBe(0);

    await electronApp.close();
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a prepared selection dropped back on the Mac pane is copied from the phone (not silently ignored)', async () => {
  const { base, fakeRoot, localStart, previewRoot } = makeDirs();
  try {
    const sd = path.join(fakeRoot, 'sdcard');
    fs.writeFileSync(path.join(sd, 'one.txt'), 'one');
    fs.writeFileSync(path.join(sd, 'two.txt'), 'two');
    const { electronApp, window } = await launch({ fakeRoot, localStart, previewRoot });

    const rows = window.locator('#phone-tbody tr');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Meta'] });
    await window.locator('#btn-prepare-finder').click();
    await expect(window.locator('#transfer-label')).toContainText('Ready', { timeout: 10000 });

    // What the drop handler sees when the native drag lands on this window: the cached copies' paths
    const cached = await window.evaluate(() => preparedFinder.localPaths);
    expect(await window.evaluate((p) => isPreparedDrop(p), cached)).toBe(true);
    expect(await window.evaluate(() => isPreparedDrop(['/somewhere/else.txt']))).toBe(false);
    expect(await window.evaluate(() => isPreparedDrop([]))).toBe(false);

    await window.evaluate((dest) => copyPreparedToMac(dest), localStart);
    await expect.poll(() => fs.readdirSync(localStart).sort(), { timeout: 10000 }).toEqual(['one.txt', 'two.txt']);
    expect(fs.readFileSync(path.join(localStart, 'one.txt'), 'utf8')).toBe('one');

    await electronApp.close();
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
