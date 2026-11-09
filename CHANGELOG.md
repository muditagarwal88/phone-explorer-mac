# Changelog

## 1.0.0 — 2026-11-10

First public release.

- Two-pane explorer: Android phone (over adb) on the left, Mac folder on the right.
- Select, Shift/Cmd multi-select, Cmd-A / Enter / Esc, hidden-files toggle.
- Copy files and folders both ways by drag and drop or toolbar buttons, with progress, speed and Cancel.
- Drag from Finder onto the phone pane.
- Phone → Finder drag via **Prepare for Finder** (pre-copy with progress, then drag).
- Double-click preview: temporary copy, opened with the default app, deleted on quit or after an hour.
  Only media and document types open; anything else is revealed in Finder.
- Copy only: no delete, rename or overwrite; name clashes save as `name (1)`.

### Security hardening before release

- File names are always shown as text, so a phone file named like HTML can't change the page.
- The window can't navigate away or open new windows; the page runs sandboxed.
- The main process only answers the app's own page, and checks every request (no `..` names, no foreign drag paths).
- Double-click opens only an allowlist of media and document types; preview copies lose execute permission.

### Fixed before release

- Phone top folder (`/sdcard`) listed only one item, because it is a symlink.
- Drag to Finder failed because the drag icon was an empty image.
- Dropping a prepared selection on the Mac pane did nothing.
