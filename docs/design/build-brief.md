# Build brief: Phone Explorer (Electron)

> **Historical record.** Written before the build (2026-10-14). The shipped app has moved on (double-click preview, file moves in the repo); see the README for current behaviour.

You are building the app described in `docs/design/design-spec.md`. Read it fully first;
it is the source of truth. Work only inside the current directory (the project root).

## Hard rules

- Do not touch anything outside this project folder. No `sudo`, no global installs (`npm install -g` is forbidden).
- Do not run `adb` against a real phone except `adb devices`. Everything else is tested against `test/fake-adb/adb`
  via the `ADB_PATH` environment variable. Never run `adb shell rm`, `uninstall`, `install`, `reboot`, `push` on a real device.
- Never use `exec` with a shell string for adb; use `execFile`/`spawn` with an argument array. Phone paths go through `shellQuote`.
- Copy-only app: no delete, rename, or overwrite features anywhere in the UI or the code.
- Do not commit to git and do not run `git init`.
- Keep code plain JavaScript (CommonJS in main/src, plain scripts in renderer). No TypeScript, no bundler, no UI framework.
- If something in the spec is impossible, do the closest safe thing and write it under "Deviations" in `README.md`. Do not silently skip.

## Order of work (finish and test each step before the next)

1. **Scaffold.** `npm init`, install `electron` and `@electron/packager` and `@playwright/test` as devDependencies. Scripts:
   `start` (electron .), `test` (node --test test/), `test:ui` (playwright test), `package` (scripts/build-app.sh).
2. **`src/adb.js`** with `findAdb`, `run(args)`, `parseDevices` (states: device / unauthorized / offline / none), `shellQuote`. Unit tests first.
3. **`src/phone-fs.js` + `src/local-fs.js`.** `parseLs` must handle: `drwxrwx--x 4 root sdcard_rw 3452 2026-10-06 23:37 1DM`,
   the same with seconds `23:37:41`, names with spaces, names with `->` symlink targets (use the link name), dot-files, unicode.
   Entry shape: `{ name, isDir, size, mtimeMs }`. Folders sort first, then case-insensitive name. Unit tests with fixtures in `test/fixtures/`.
4. **`test/fake-adb/adb`** (Node script, executable): serves a virtual phone from the directory in `FAKE_ADB_ROOT`; supports
   `devices -l`, `-s SERIAL shell ls -lA <dir>`, `shell stat -c %s <path>`, `pull [-a] <remote> <local>`, `push <local> <remote>`;
   respects `FAKE_ADB_STATE` (device/unauthorized/offline/none) and `FAKE_ADB_DELAY_MS` per file to test progress and cancel.
5. **`src/transfer.js`.** Pull/push jobs per spec: expand folders with a recursive walk, total bytes up front, one file at a time,
   progress events `{label, filesDone, filesTotal, bytesDone, bytesTotal, speed}`, cancel kills the child and deletes only its partial file,
   clash → `name (1)`. Tests against fake-adb: nested folder round trip compared by SHA-256, cancel leaves no partial, clash handling.
6. **`src/dragcache.js`** ("Prepare for Finder"). Cache under `os.tmpdir()/phone-explorer-cache`, reuse when remote size+mtime unchanged,
   refuse when free space < selection size + 1 GB, wipe on app start and quit. Tests against fake-adb.
7. **`main.js`, `preload.js`, renderer.** Two panes, breadcrumbs, Up, shortcuts menus, columns, sort, hidden-files toggle,
   multi-select (click, Shift, Cmd, Cmd-A, Esc), double-click/Return to open, toolbar device status with the error messages from the spec,
   transfer bar with progress and Cancel, "Copy to Mac →" / "← Copy to phone" buttons, pane-to-pane HTML5 drag and drop,
   Finder → phone-pane drop via `webUtils.getPathForFile`, and the phone → Finder flow exactly as the spec describes
   (drag out and release or press "Prepare for Finder" → progress → "Ready" → second drag uses `webContents.startDrag`).
   Pass `{ env }` through so `ADB_PATH`, `FAKE_ADB_ROOT`, `FAKE_ADB_STATE` reach the app. Look clean and calm: system font, light/dark via
   `prefers-color-scheme`, clear selected-row highlight, drop-target highlight.
8. **UI smoke test** (`test/ui/smoke.spec.js`, Playwright `_electron`, fake adb): launch, device shown, phone pane lists folders,
   select two items with Cmd-click, drag onto the Mac pane, assert the files exist in the Mac folder (use a temp folder as the Mac pane's start path via an env var `PHONE_EXPLORER_LOCAL_START`).
9. **Packaging.** `scripts/build-app.sh` produces `dist/Phone Explorer.app` with `@electron/packager` (darwin, arm64, unsigned), and copies it to `~/Applications`
   only if the user passes `--install`. Create `Phone Explorer.command` (executable) that `cd`s to its folder and runs `npm start`.
10. **README.md**: one-time phone setup, how to run (double-click `.command`, or `npm start`, or the packaged `.app`), how to test, the Finder-drag behaviour, Deviations.

## Definition of done

Run and show the final output of: `npm test` (all pass), `npm run test:ui` (passes), `npm run package` (app bundle exists).
End with a short report: what works, what you could not verify without a real phone, any deviations.
