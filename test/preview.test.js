const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
  const prev = process.env.PHONE_EXPLORER_PREVIEW_ROOT;
  process.env.PHONE_EXPLORER_PREVIEW_ROOT = path.join(root, 'previews');
  try {
    return fn(path.join(root, 'previews'));
  } finally {
    if (prev === undefined) delete process.env.PHONE_EXPLORER_PREVIEW_ROOT;
    else process.env.PHONE_EXPLORER_PREVIEW_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const preview = require('../src/preview');

test('preview.isSafeToOpen allows only media and documents, case-insensitively', () => {
  for (const name of ['photo.jpg', 'IMG.HEIC', 'movie.mp4', 'voice.m4a', 'doc.pdf', 'notes.txt', 'sheet.xlsx']) {
    assert.equal(preview.isSafeToOpen(name), true, name);
  }
  for (const name of ['setup.command', 'Tool.APP', 'x.pkg', 'run.SH', 'a.jar', 'link.webloc', 'evil.scpt',
    'noext', 'report.pdf.command', 'page.html', 'app.apk', 'archive.zip', 'contact.vcf', '.hidden']) {
    assert.equal(preview.isSafeToOpen(name), false, name);
  }
});

test('preview.makeInert strips execute bits and refuses non-files', () => {
  withRoot(() => {
    const dir = preview.newPreviewDir();
    const f = path.join(dir, 'clip.mp4');
    fs.writeFileSync(f, 'x');
    fs.chmodSync(f, 0o755);
    assert.equal(preview.makeInert(f), true);
    assert.equal(fs.statSync(f).mode & 0o111, 0);
    const link = path.join(dir, 'link.mp4');
    fs.symlinkSync('/etc/hosts', link);
    assert.equal(preview.makeInert(link), false);
    assert.equal(preview.makeInert(dir), false);
  });
});

test('preview.newPreviewDir gives a fresh empty folder each time under the preview root', () => {
  withRoot((root) => {
    const a = preview.newPreviewDir();
    const b = preview.newPreviewDir();
    assert.notEqual(a, b);
    assert.equal(path.dirname(a), root);
    assert.deepEqual(fs.readdirSync(a), []);
  });
});

test('preview.wipe deletes every preview copy', () => {
  withRoot((root) => {
    fs.writeFileSync(path.join(preview.newPreviewDir(), 'one.txt'), '1');
    fs.writeFileSync(path.join(preview.newPreviewDir(), 'two.txt'), '2');
    preview.wipe();
    assert.equal(fs.existsSync(root), false);
    preview.wipe(); // wiping when nothing exists must not throw
  });
});

test('preview.sweep deletes only copies older than the limit', () => {
  withRoot(() => {
    const oldDir = preview.newPreviewDir();
    const newDir = preview.newPreviewDir();
    fs.writeFileSync(path.join(oldDir, 'old.txt'), 'old');
    fs.writeFileSync(path.join(newDir, 'new.txt'), 'new');
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(oldDir, twoHoursAgo, twoHoursAgo);

    assert.equal(preview.sweep(3600 * 1000), 1);
    assert.equal(fs.existsSync(oldDir), false);
    assert.equal(fs.existsSync(newDir), true);
  });
});
