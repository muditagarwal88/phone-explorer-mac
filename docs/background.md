# Why Phone Explorer exists

A short history of the problem, what we tried, and what we learned on the way to building this app.

## The problem

An Android phone (a OnePlus 9) plugged into a MacBook Air showed up nowhere. Finder only understands iPhones.
Android phones share files over **MTP** (Media Transfer Protocol), and macOS has no built-in MTP support.
So copying a folder of videos off the phone, or putting an APK on it, meant extra tools every time.

## What we tried first

| Step | What happened | What we learned |
|---|---|---|
| Check the USB link | The Mac saw the phone in File Transfer mode, but nothing on the Mac could read its files | You need an MTP app (for example OpenMTP) or a command-line tool |
| `libmtp` from Homebrew | `mtp-detect` failed: "Unable to open raw device" | macOS's Image Capture service (`ptpcamerad`) grabs every MTP/PTP device as soon as it is plugged in. It has to be stopped (`killall -9 ptpcamerad`) before each connection, and it comes back |
| List the whole phone over MTP | About 90 seconds per listing | MTP rescans everything. A small helper that opens one folder at a time took seconds |
| That helper listed only "Pictures" at the top level | libmtp reused a cached device and asked for storage ID 0 | Open the device uncached and pass the real storage ID |
| Copy a 4.4 GB folder of 14 videos | Worked, verified byte for byte | It works, but every step needed hand-holding |
| Replug or restart the phone | The phone vanished | Android sometimes switches the USB mode to **MIDI**. You have to pick "File transfer" again in the USB notification |
| Install a debug APK on the phone, several times over | `adb push` over USB debugging was quick and checkable (SHA-256) | **adb is the better channel**: made by Google, no fight with `ptpcamerad`, full view of `/sdcard`, fast, scriptable |

## Why build an app

The command line worked, but the daily need was simple: **see the phone and the Mac side by side, and drag things across.**
Existing MTP apps inherit MTP's slowness and the `ptpcamerad` fight. So we built a small two-pane explorer on top of adb.

Goals:

- Two panes, phone on the left and Mac on the right, like a classic file manager.
- Select, Shift/Cmd multi-select, folders as well as files.
- Drag and drop both ways, plus drag from the phone into Finder.
- A progress bar with Cancel for big copies.
- Double-click to preview a phone file without copying it anywhere permanent.
- **Copy only.** It never deletes, renames or overwrites. A name clash saves as `name (1)`.

## Key decisions

| Decision | Chosen | Instead of | Why |
|---|---|---|---|
| Phone link | adb over USB debugging | MTP / libmtp | Faster, reliable, no `ptpcamerad` conflict, full file listing with sizes and dates |
| App shell | Electron | Native SwiftUI | Drags can be tested automatically with Playwright; same layout either way. Cost: a phone → Finder drag needs the files copied to the Mac first |
| Safety | Copy only | Full file manager | Nothing on the phone or the Mac can be lost by a slip of the mouse |
| Previews | Temporary copy, deleted later | Opening files in place | Phone files are untrusted. Scripts and apps are shown in Finder instead of being run |

## Problems found while building, and the fixes

| Problem | Cause | Fix |
|---|---|---|
| The phone's top folder showed one item | `/sdcard` is a symlink: `ls -lA /sdcard` lists the link itself | Always list `dir/` with a trailing slash. The test phone now behaves the same way |
| A phone → Finder drag can't start right away | Electron has no macOS "file promises": files must exist on the Mac before the drag | **Prepare for Finder** copies them to a cache with a progress bar, then you drag |
| The drag to Finder silently failed | macOS only starts a drag while the mouse button is down, and the drag icon decoded to an empty image | Start the drag immediately on drag start; the icon is now built from raw pixels and tested |
| After Prepare, dropping on the Mac pane did nothing | A prepared drag carries Finder-style file paths, not phone data | The Mac pane recognises a prepared drag and copies from the phone |
| "Phone connected but not detected" | USB debugging off, USB mode set to MIDI or charging, or the Allow prompt not tapped | See [troubleshooting.md](troubleshooting.md) |
| UI tests passed once, then failed | A saved setting (the preview checkbox) leaked between test runs | Each test gets its own profile folder |

## USB mode cheat sheet (OnePlus / OPPO vendor ID `22d9`)

| USB ID | Phone mode | Who can see it |
|---|---|---|
| `18d1:4ee8` | MIDI | Nothing useful |
| `22d9:2764` | File transfer, USB debugging off | MTP apps only |
| `22d9:2765` | File transfer, USB debugging on | MTP apps and adb (this app) |

Other brands use other IDs. On the Mac, **System Information ▸ USB** shows what the phone is presenting.

## How it was built

Designed, reviewed, tested and debugged with **Claude Code**. The first draft of the Electron code was written by
Gemini 3.8 Flash through the Antigravity CLI from a written spec and brief (see [`design/`](design/)), then tested
against a fake adb and a real phone and finished in Claude Code.
