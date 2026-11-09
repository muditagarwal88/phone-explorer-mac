# Changelog

## 1.0.0 — 2026-11-10

First public release.

- Two-pane explorer: Android phone (over adb) on the left, Mac folder on the right.
- Select, Shift/Cmd multi-select, Cmd-A / Enter / Esc, hidden-files toggle.
- Copy files and folders both ways by drag and drop or toolbar buttons, with progress, speed and Cancel.
- Drag from Finder onto the phone pane.
- Phone → Finder drag via **Prepare for Finder** (pre-copy with progress, then drag).
- Double-click preview: temporary copy, opened with the default app, deleted on quit or after an hour.
  Scripts and apps are revealed in Finder instead of being run.
- Copy only: no delete, rename or overwrite; name clashes save as `name (1)`.

### Fixed before release

- Phone top folder (`/sdcard`) listed only one item, because it is a symlink.
- Drag to Finder failed because the drag icon was an empty image.
- Dropping a prepared selection on the Mac pane did nothing.
