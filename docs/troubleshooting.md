# Troubleshooting

## The app says "Plug in your phone", but it is plugged in

Work down this list. The app re-checks every 2 seconds, so it updates on its own.

1. **Unlock the phone.**
2. **USB debugging is on:** Settings ▸ About phone ▸ tap **Build number** 7 times, then Settings ▸ System (or Additional settings) ▸ Developer options ▸ **USB debugging**.
3. **USB mode is File transfer:** swipe down on the phone, tap the **USB** notification, choose **File transfer**. Some phones switch to MIDI or charging-only after a restart or replug, which hides them from the Mac.
4. **Tap Allow** on the phone's "Allow USB debugging?" prompt. Tick "Always allow from this computer".
5. **Try another cable or port.** Charge-only cables carry power but no data.

Check from Terminal:

```bash
adb devices -l
```

| Output | Meaning |
|---|---|
| `<serial>  device ...` | Connected. The app should show the phone |
| `<serial>  unauthorized` | Tap Allow on the phone |
| Empty list | USB debugging off, wrong USB mode, or a charge-only cable |
| `command not found: adb` | adb isn't installed (next section) |

## "Install Android platform-tools"

The app needs Google's `adb` tool:

```bash
brew install --cask android-platform-tools
```

The app looks for adb in `~/Library/Android/sdk/platform-tools`, `/opt/homebrew/bin`, `/usr/local/bin`, then your `PATH`.
To point it somewhere else, start it with `ADB_PATH=/path/to/adb`.

## macOS won't open the app

The app is not signed with an Apple Developer ID, so macOS warns the first time.

- Open **System Settings ▸ Privacy & Security**, scroll down, and click **Open Anyway** next to Phone Explorer.
- Or, from Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Phone Explorer.app"
```

## Dragging to Finder does nothing

Dragging phone files out to Finder takes two steps, because macOS needs the files on the Mac first:

1. Select the files and click **Prepare for Finder** (or drag once outside the window). A progress bar shows the copy.
2. When the bar says **Ready**, drag the same selection to Finder.

Dragging between the two panes needs no preparation.

## A double-clicked file was shown in Finder instead of opening

Only photos, videos, music and common documents (PDF, text, Office, iWork) open with a double-click.
Anything else, such as apps, scripts, installers, web pages or files with no extension, is revealed in Finder
so you decide what to do with it. Files from a phone are never run automatically.

## Where are the temporary copies?

- Previews: `$TMPDIR/phone-explorer-preview`. Deleted on quit, on the next launch, and after one hour.
- Finder drag cache: `$TMPDIR/phone-explorer-cache`. Deleted on quit and on the next launch.
