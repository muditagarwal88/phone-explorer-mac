const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/ipc-guard');

const pull = (over = {}) => ({ direction: 'pull', sourceDir: '/sdcard/Download', destDir: '/Users/x/Downloads',
  items: [{ name: 'a.jpg', isDir: false, size: 1, mtimeMs: 0 }], ...over });

test('ipc-guard: a normal pull and push pass, and the window cannot pick the phone serial', () => {
  const ok = guard.checkTransfer({ ...pull(), serial: 'someone-else' });
  assert.equal(ok.direction, 'pull');
  assert.equal('serial' in ok, false);
  assert.doesNotThrow(() => guard.checkTransfer({ direction: 'push', sourceDir: '/Users/x', destDir: '/sdcard/Download',
    items: [{ name: 'b.txt', isDir: false }] }));
  assert.doesNotThrow(() => guard.checkTransfer({ direction: 'push', sourceDir: '', destDir: '/sdcard',
    items: [{ name: 'c.pdf', path: '/Users/x/Desktop/c.pdf' }] }));
});

test('ipc-guard: names that escape the folder are rejected', () => {
  for (const name of ['..', '.', '../../Library/LaunchAgents/x.plist', 'a/b', '', 'x\0y', 42, null]) {
    assert.throws(() => guard.checkTransfer(pull({ items: [{ name }] })), /Rejected/, String(name));
  }
});

test('ipc-guard: bad shapes are rejected', () => {
  assert.throws(() => guard.checkTransfer(pull({ direction: 'delete' })), /Rejected/);
  assert.throws(() => guard.checkTransfer(pull({ destDir: 'relative/dir' })), /Rejected/);
  assert.throws(() => guard.checkTransfer(pull({ items: [] })), /Rejected/);
  assert.throws(() => guard.checkTransfer(pull({ items: 'a.jpg' })), /Rejected/);
  // A pull may not carry a Mac path, and a Finder push path must match its name
  assert.throws(() => guard.checkTransfer(pull({ items: [{ name: 'a', path: '/etc/a' }] })), /Rejected/);
  assert.throws(() => guard.checkTransfer({ direction: 'push', sourceDir: '', destDir: '/sdcard',
    items: [{ name: 'photo.jpg', path: '/Users/x/.ssh/id_rsa' }] }), /Rejected/);
  assert.throws(() => guard.checkTransfer({ direction: 'push', sourceDir: '', destDir: '/sdcard',
    items: [{ name: 'photo.jpg' }] }), /Rejected/);
});

test('ipc-guard: only drag-cache files can be dragged out', () => {
  const cache = '/tmp/phone-explorer-cache';
  assert.doesNotThrow(() => guard.checkCachedPaths(['/tmp/phone-explorer-cache/k/a.jpg'], cache));
  assert.throws(() => guard.checkCachedPaths(['/Users/x/.ssh/id_rsa'], cache), /Rejected/);
  assert.throws(() => guard.checkCachedPaths(['/tmp/phone-explorer-cache/../secret'], cache), /Rejected/);
  assert.throws(() => guard.checkCachedPaths([], cache), /Rejected/);
});

test('ipc-guard: phone selections need an absolute phone folder and plain names', () => {
  assert.doesNotThrow(() => guard.checkPhoneSelection('/sdcard/DCIM', [{ name: 'IMG_1.jpg' }]));
  assert.throws(() => guard.checkPhoneSelection('sdcard', [{ name: 'IMG_1.jpg' }]), /Rejected/);
  assert.throws(() => guard.checkPhoneSelection('/sdcard', [{ name: '../x' }]), /Rejected/);
});
