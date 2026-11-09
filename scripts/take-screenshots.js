#!/usr/bin/env node
// Regenerates docs/screenshots/*.png from a fake phone with made-up files. No real phone or personal data needed.
// Usage: node scripts/take-screenshots.js
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

(async () => {
  const base = path.join(os.tmpdir(), 'phone-explorer-demo');
  fs.rmSync(base, { recursive: true, force: true });
  const phone = path.join(base, 'phone');
  const mac = path.join(base, 'Mac Downloads');
  const sd = path.join(phone, 'sdcard');

  const makeFile = (file, mb, daysAgo) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    fs.truncateSync(file, Math.round(mb * 1024 * 1024)); // sparse: takes no real disk space
    const t = new Date(Date.now() - daysAgo * 864e5);
    fs.utimesSync(file, t, t);
  };
  for (const d of ['DCIM/Camera', 'Pictures/Screenshots', 'Movies', 'Music', 'Documents', 'Podcasts']) {
    fs.mkdirSync(path.join(sd, d), { recursive: true });
  }
  makeFile(path.join(sd, 'Download/Trip photos.zip'), 84.2, 3);
  makeFile(path.join(sd, 'Download/Lecture 01.mp4'), 312, 5);
  makeFile(path.join(sd, 'Download/Lecture 02.mp4'), 287.5, 5);
  makeFile(path.join(sd, 'Download/Lecture 03.mp4'), 301.9, 4);
  makeFile(path.join(sd, 'Download/Invoice-2026-10.pdf'), 0.14, 9);
  makeFile(path.join(sd, 'Download/notes.txt'), 0.002, 12);
  makeFile(path.join(sd, 'Download/Study material/chapter1.pdf'), 3.1, 20);
  makeFile(path.join(mac, 'Resume.pdf'), 0.2, 2);
  makeFile(path.join(mac, 'Budget.xlsx'), 0.05, 6);
  fs.mkdirSync(path.join(mac, 'Phone backup'), { recursive: true });

  const app = await electron.launch({
    args: [path.join(ROOT, 'main.js'), `--user-data-dir=${path.join(base, 'profile')}`],
    env: {
      ...process.env,
      ADB_PATH: path.join(ROOT, 'test/fake-adb/adb'),
      FAKE_ADB_ROOT: phone,
      FAKE_ADB_STATE: 'device',
      FAKE_ADB_DELAY_MS: '700',
      PHONE_EXPLORER_LOCAL_START: mac
    }
  });
  try {
    const w = await app.firstWindow();
    await w.setViewportSize({ width: 1180, height: 720 });
    await w.waitForSelector('#phone-tbody tr', { timeout: 15000 });
    await w.locator('#phone-tbody tr', { hasText: 'Download' }).first().dblclick();
    await w.waitForSelector('#phone-tbody tr:has-text("Lecture 01")', { timeout: 10000 });
    await w.locator('#phone-tbody tr', { hasText: 'Lecture 01' }).click();
    await w.locator('#phone-tbody tr', { hasText: 'Lecture 03' }).click({ modifiers: ['Shift'] });
    await w.waitForTimeout(400);
    await w.screenshot({ path: path.join(OUT, '01-select.png') });
    await w.locator('#btn-copy-to-mac').click();
    await w.waitForTimeout(1500);
    await w.screenshot({ path: path.join(OUT, '02-copying.png') });
  } finally {
    await app.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
  console.log(`Screenshots written to ${path.relative(ROOT, OUT)}/`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
