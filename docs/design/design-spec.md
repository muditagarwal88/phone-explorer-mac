# Phone Explorer (Electron, macOS) — design

> **Historical record.** Written before the build (2026-10-14). The shipped app has moved on (double-click preview, file moves in the repo); see the README for current behaviour.

Date: 2026-10-14 · Status: **approved by the user to build** ("Electron, let's build") · Supersedes the SwiftUI draft.

## Intent

A small Mac desktop app the user double-clicks to browse their Android phone (OnePlus 9 5G) next to a Mac folder, and move
files and folders between them by selecting, multi-selecting and dragging. "Fairly easy explorer."

Chosen by the user: Electron; USB debugging through `adb`; both directions; copy only; a progress indicator while phone files are
being copied to the Mac before a drag to Finder.

Success = plug in the phone, open the app, see phone folders on the left and a Mac folder on the right, move a mix of files and
folders either way, and every file arrives byte-identical.

## Out of scope (v1)

Delete, rename, new folder, overwrite, thumbnails/preview, wireless adb, several phones at once, signing/notarization.

## Stack

Electron (latest stable), plain HTML/CSS/JS in the renderer (no framework, no bundler), Node 22 in the main process.
`contextIsolation: true`, `nodeIntegration: false`, a preload script exposing a small API, strict CSP.
Tests: Node's built-in runner (`node --test`) plus one Playwright-Electron smoke test. Packaging: `@electron/packager` to `dist/Phone Explorer.app` (unsigned, local use).

## Files

| File | Does |
|---|---|
| `main.js` | Window, IPC handlers, owns adb + transfers |
| `preload.js` | `contextBridge` API for the renderer; wraps `webUtils.getPathForFile` |
| `src/adb.js` | Find `adb` (`ADB_PATH` env, `~/Library/Android/sdk/platform-tools/adb`, `/opt/homebrew/bin/adb`, PATH); `execFile` runner (args array, never a shell string); `parseDevices`; `shellQuote` |
| `src/phone-fs.js` | `list(serial, dir)` via `adb shell ls -lA`; `parseLs`; `stat`; `walk` (recursive file list with sizes) |
| `src/local-fs.js` | Same `list` shape for Mac folders |
| `src/transfer.js` | Job queue: pull / push, one file at a time, bytes-done, cancel, name-clash → `name (1)`, partial-file cleanup |
| `src/dragcache.js` | "Prepare for Finder": pull selection into a temp cache, report progress, reuse if unchanged, free-disk check, wipe on quit/start |
| `renderer/index.html, renderer.js, styles.css` | Two panes, path bars, transfer bar, drag and drop |
| `test/` | Unit tests, fixtures, `fake-adb/adb` (a Node script emulating adb over a temp directory), UI smoke test |
| `scripts/build-app.sh`, `Phone Explorer.command`, `README.md` | Packaging, double-click launcher, setup steps |

## Behaviour

- **Layout:** toolbar (device status, "Show hidden files"), two panes (phone left, Mac right), each with breadcrumbs, Up, and a shortcuts menu; transfer bar at the bottom.
- **Columns:** Name (folder/file icon), Size, Modified. Folders first, click header to sort. Names starting with `.` hidden by default.
- **Selection:** click, Shift-click, Cmd-click, Cmd-A. Double-click or Return opens a folder. Esc clears.
- **Shortcuts:** phone → Internal storage `/sdcard`, DCIM, Download, Pictures, Movies, Documents, Music. Mac → Home, Downloads, Desktop, Documents.
- **Phone → Mac pane:** drag the selection onto the Mac pane (copies into the folder shown, or into a folder row it is dropped on) — direct `adb pull`, no temp copy.
- **Mac → phone pane:** same, `adb push`. Dropping files from **Finder** onto the phone pane also pushes (paths via `webUtils.getPathForFile`).
- **Buttons:** "Copy to Mac →" and "← Copy to phone" act on the current selection (the non-drag path).
- **Phone → Finder (the one that needs a pre-copy):** Electron can only start a native drag for files that already exist on the Mac.
  1. Drag phone rows out of the window and release (or press **Prepare for Finder**). The app copies the selection into a temp cache and shows a progress bar in the transfer bar, labelled "Preparing for Finder — 3 of 14 files, 41%, Cancel".
  2. When done it says "Ready — drag the selection to Finder now."
  3. Dragging that same selection again starts a native drag (`webContents.startDrag`) immediately, so Finder gets the real files at once.
  Cache lives under the OS temp dir, is reused while the phone files are unchanged, and is deleted on quit and on next start. If free disk space is less than selection size + 1 GB, refuse with a clear message.
- **Progress for all jobs:** total bytes known up front (recursive walk); the in-flight file is measured by polling the destination size (Mac: `fs.stat`; phone: `adb shell stat -c %s`). Shows files done, bytes, percent, speed, Cancel.
- **Never destructive:** no delete, no overwrite. Cancel or failure removes only the partial file the app itself was writing.

## Safety rules for the code

- Remote (phone) paths are single-quote escaped with `shellQuote` and unit-tested with spaces, quotes, `$`, backticks, unicode, newlines.
- adb is only ever invoked with these verbs: `devices`, `get-state`, `shell ls`, `shell stat`, `shell find`, `pull`, `push`. Nothing that writes or deletes on the phone except `push` into a folder the user dropped on.

## Error states (in-app text, never a crash)

| State | Message |
|---|---|
| `adb` not found | "Install Android platform-tools" + the command `brew install --cask android-platform-tools` |
| No device | "Plug in your phone with a USB cable" |
| `unauthorized` | "Tap Allow on the phone's USB debugging prompt" |
| `offline` | "Unplug and replug the cable" |
| Folder unreadable | Inline row "Can't read this folder"; pane stays usable |
| A file fails | Job continues; summary lists failures |
| Phone unplugged mid-transfer | Job stops, shows what finished |

Device state is polled with `adb devices -l` every 2 s.

## One-time phone setup

Settings ▸ About phone ▸ tap Build number 7 times ▸ Developer options ▸ USB debugging on ▸ tap Allow on the phone's prompt.

## Testing

- **Unit (no phone):** `parseLs` against fixtures (spaces, quotes, unicode, symlinks, dot-files, `HH:MM` and `HH:MM:SS` times), `shellQuote`, `parseDevices`, name-clash resolver, path join/parent.
- **Engine tests with `fake-adb`:** pull/push a nested folder, byte-compare with SHA-256, cancel mid-file leaves no partial, clash gives `name (1)`, "Prepare for Finder" reuses the cache.
- **UI smoke (Playwright `_electron`, fake adb via `ADB_PATH`):** app launches, shows device, phone pane lists folders, multi-select two items, drag them onto the Mac pane, files appear on disk.
- **Manual with the user, phone plugged in:** real `ls` output parses, Finder drags (both ways), cancel, unplug mid-transfer.

## Risks / unverified

1. Real `ls -lA` output on this phone is assumed from Android's toybox format; the parser must tolerate both time styles and be re-checked once the phone is plugged in (it is not plugged in now).
2. `webContents.startDrag` with many files or folders into Finder is untested here.
3. USB debugging may not yet be enabled on the phone.
4. Android hides some folders (e.g. other apps' data under `Android/`); they show as unreadable.
