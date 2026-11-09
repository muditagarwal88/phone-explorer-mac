// State
let currentPhoneDir = '/sdcard';
let currentLocalDir = '';
let homeDir = '';
let phoneEntries = [];
let localEntries = [];
let phoneSelection = new Set();
let localSelection = new Set();
let lastPhoneIndex = -1;
let lastLocalIndex = -1;
let phoneSort = { col: 'name', asc: true };
let localSort = { col: 'name', asc: true };
let showHidden = false;
let activePane = 'phone'; // 'phone' | 'mac'
let preparedFinder = { key: null, localPaths: null, sourceDir: null, items: null }; // phone selection already copied to the Mac, ready for a native drag
let isTransferring = false;

// DOM Elements
const elDeviceStatus = document.getElementById('device-status');
const elDeviceStatusText = document.getElementById('device-status-text');
const elShowHidden = document.getElementById('chk-show-hidden');
const elPreviewOnDblclick = document.getElementById('chk-preview');
const elBtnCopyToMac = document.getElementById('btn-copy-to-mac');
const elBtnCopyToPhone = document.getElementById('btn-copy-to-phone');
const elBtnPrepareFinder = document.getElementById('btn-prepare-finder');

const elPhonePane = document.getElementById('phone-pane');
const elPhoneBreadcrumbs = document.getElementById('phone-breadcrumbs');
const elPhoneUpBtn = document.getElementById('phone-up-btn');
const elPhoneShortcuts = document.getElementById('phone-shortcuts');
const elPhoneTbody = document.getElementById('phone-tbody');
const elPhoneError = document.getElementById('phone-error');
const elPhoneEmpty = document.getElementById('phone-empty');

const elMacPane = document.getElementById('mac-pane');
const elMacBreadcrumbs = document.getElementById('mac-breadcrumbs');
const elMacUpBtn = document.getElementById('mac-up-btn');
const elMacShortcuts = document.getElementById('mac-shortcuts');
const elMacTbody = document.getElementById('mac-tbody');
const elMacError = document.getElementById('mac-error');
const elMacEmpty = document.getElementById('mac-empty');

const elTransferLabel = document.getElementById('transfer-label');
const elTransferSpeed = document.getElementById('transfer-speed');
const elTransferProgressBar = document.getElementById('transfer-progress-bar');
const elBtnCancelTransfer = document.getElementById('btn-cancel-transfer');

// Formatters
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(ms) {
  if (!ms || ms === 0) return '-';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// Helpers
function getSelectionKey(dir, items) {
  const names = Array.from(items).sort().join('|');
  return `${dir}::${names}`;
}

function sortEntries(entries, sortConfig) {
  return [...entries].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;

    let res = 0;
    if (sortConfig.col === 'size') {
      res = a.size - b.size;
    } else if (sortConfig.col === 'mtime') {
      res = a.mtimeMs - b.mtimeMs;
    } else {
      res = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }

    return sortConfig.asc ? res : -res;
  });
}

function filterEntries(entries) {
  if (showHidden) return entries;
  return entries.filter(e => !e.name.startsWith('.'));
}

// Rendering
function renderPhoneTable() {
  elPhoneTbody.innerHTML = '';
  const filtered = filterEntries(phoneEntries);
  const sorted = sortEntries(filtered, phoneSort);

  if (sorted.length === 0) {
    elPhoneEmpty.classList.remove('hidden');
  } else {
    elPhoneEmpty.classList.add('hidden');
  }

  sorted.forEach((entry, index) => {
    const tr = document.createElement('tr');
    tr.className = 'file-row';
    tr.draggable = true;
    tr.dataset.name = entry.name;
    tr.dataset.index = index;
    if (phoneSelection.has(entry.name)) {
      tr.classList.add('selected');
    }

    const icon = entry.isDir ? '📁' : '📄';
    const sizeDisplay = entry.isDir ? '-' : formatBytes(entry.size);
    const mtimeDisplay = formatDate(entry.mtimeMs);

    tr.innerHTML = `
      <td class="col-name"><span class="item-icon">${icon}</span>${entry.name}</td>
      <td class="col-size">${sizeDisplay}</td>
      <td class="col-mtime">${mtimeDisplay}</td>
    `;

    tr.addEventListener('click', (e) => handleRowClick(e, 'phone', entry.name, index, sorted));
    tr.addEventListener('dblclick', () => openPhoneEntry(entry));

    // Drag handlers
    tr.addEventListener('dragstart', (e) => handlePhoneDragStart(e, entry));
    tr.addEventListener('dragend', (e) => handlePhoneDragEnd(e));

    elPhoneTbody.appendChild(tr);
  });

  renderBreadcrumbs('phone', currentPhoneDir);
}

function renderMacTable() {
  elMacTbody.innerHTML = '';
  const filtered = filterEntries(localEntries);
  const sorted = sortEntries(filtered, localSort);

  if (sorted.length === 0) {
    elMacEmpty.classList.remove('hidden');
  } else {
    elMacEmpty.classList.add('hidden');
  }

  sorted.forEach((entry, index) => {
    const tr = document.createElement('tr');
    tr.className = 'file-row';
    tr.draggable = true;
    tr.dataset.name = entry.name;
    tr.dataset.index = index;
    if (localSelection.has(entry.name)) {
      tr.classList.add('selected');
    }

    const icon = entry.isDir ? '📁' : '📄';
    const sizeDisplay = entry.isDir ? '-' : formatBytes(entry.size);
    const mtimeDisplay = formatDate(entry.mtimeMs);

    tr.innerHTML = `
      <td class="col-name"><span class="item-icon">${icon}</span>${entry.name}</td>
      <td class="col-size">${sizeDisplay}</td>
      <td class="col-mtime">${mtimeDisplay}</td>
    `;

    tr.addEventListener('click', (e) => handleRowClick(e, 'mac', entry.name, index, sorted));
    tr.addEventListener('dblclick', () => openMacEntry(entry));

    // Drag handlers
    tr.addEventListener('dragstart', (e) => handleMacDragStart(e, entry));

    // Allow dropping inside a Mac folder row
    if (entry.isDir) {
      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        tr.classList.add('drop-target-row');
      });
      tr.addEventListener('dragleave', () => {
        tr.classList.remove('drop-target-row');
      });
      tr.addEventListener('drop', (e) => {
        tr.classList.remove('drop-target-row');
        handleDropOnMac(e, currentLocalDir.endsWith('/') ? `${currentLocalDir}${entry.name}` : `${currentLocalDir}/${entry.name}`);
      });
    }

    elMacTbody.appendChild(tr);
  });

  renderBreadcrumbs('mac', currentLocalDir);
}

function renderBreadcrumbs(pane, fullPath) {
  const container = pane === 'phone' ? elPhoneBreadcrumbs : elMacBreadcrumbs;
  container.innerHTML = '';

  const parts = fullPath.split('/').filter(Boolean);
  let accumulated = '';

  // Root crumb
  const rootCrumb = document.createElement('span');
  rootCrumb.className = 'crumb';
  rootCrumb.textContent = pane === 'phone' ? 'Phone' : 'Mac';
  rootCrumb.addEventListener('click', () => {
    if (pane === 'phone') navigateToPhone('/sdcard');
    else navigateToMac(homeDir);
  });
  container.appendChild(rootCrumb);

  parts.forEach((part, i) => {
    const sep = document.createElement('span');
    sep.className = 'crumb-separator';
    sep.textContent = ' / ';
    container.appendChild(sep);

    accumulated += '/' + part;
    const targetPath = accumulated;
    const crumb = document.createElement('span');
    crumb.className = 'crumb';
    crumb.textContent = part;
    crumb.addEventListener('click', () => {
      if (pane === 'phone') navigateToPhone(targetPath);
      else navigateToMac(targetPath);
    });
    container.appendChild(crumb);
  });
}

// Selection handling
function handleRowClick(e, pane, name, index, list) {
  activePane = pane;
  const selection = pane === 'phone' ? phoneSelection : localSelection;
  const lastIdx = pane === 'phone' ? lastPhoneIndex : lastLocalIndex;

  if (e.metaKey || e.ctrlKey) {
    if (selection.has(name)) selection.delete(name);
    else selection.add(name);
    if (pane === 'phone') lastPhoneIndex = index;
    else lastLocalIndex = index;
  } else if (e.shiftKey && lastIdx >= 0) {
    selection.clear();
    const start = Math.min(lastIdx, index);
    const end = Math.max(lastIdx, index);
    for (let i = start; i <= end; i++) {
      selection.add(list[i].name);
    }
  } else {
    selection.clear();
    selection.add(name);
    if (pane === 'phone') lastPhoneIndex = index;
    else lastLocalIndex = index;
  }

  if (pane === 'phone') renderPhoneTable();
  else renderMacTable();
}

// Navigation
async function navigateToPhone(dir) {
  try {
    elPhoneError.classList.add('hidden');
    currentPhoneDir = dir;
    phoneSelection.clear();
    lastPhoneIndex = -1;
    phoneEntries = await window.api.listPhone(dir);
    renderPhoneTable();
  } catch (err) {
    phoneEntries = [];
    renderPhoneTable();
    elPhoneError.classList.remove('hidden');
  }
}

async function navigateToMac(dir) {
  try {
    elMacError.classList.add('hidden');
    currentLocalDir = dir;
    localSelection.clear();
    lastLocalIndex = -1;
    localEntries = await window.api.listLocal(dir);
    renderMacTable();
  } catch (err) {
    localEntries = [];
    renderMacTable();
    elMacError.classList.remove('hidden');
  }
}

// Up navigation
function getParentDir(fullPath) {
  if (!fullPath || fullPath === '/') return '/';
  const parts = fullPath.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  parts.pop();
  return '/' + parts.join('/');
}

elPhoneUpBtn.addEventListener('click', () => {
  navigateToPhone(getParentDir(currentPhoneDir));
});

elMacUpBtn.addEventListener('click', () => {
  navigateToMac(getParentDir(currentLocalDir));
});

// Shortcuts
elPhoneShortcuts.addEventListener('change', (e) => {
  if (e.target.value) {
    navigateToPhone(e.target.value);
    e.target.value = '';
  }
});

elMacShortcuts.addEventListener('change', (e) => {
  const val = e.target.value;
  if (!val) return;
  let target = homeDir;
  if (val === 'downloads') target = `${homeDir}/Downloads`;
  else if (val === 'desktop') target = `${homeDir}/Desktop`;
  else if (val === 'documents') target = `${homeDir}/Documents`;
  navigateToMac(target);
  e.target.value = '';
});

// Sorting Header clicks
document.querySelectorAll('#phone-table th').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (phoneSort.col === col) {
      phoneSort.asc = !phoneSort.asc;
    } else {
      phoneSort.col = col;
      phoneSort.asc = true;
    }
    renderPhoneTable();
  });
});

document.querySelectorAll('#mac-table th').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (localSort.col === col) {
      localSort.asc = !localSort.asc;
    } else {
      localSort.col = col;
      localSort.asc = true;
    }
    renderMacTable();
  });
});

// Preview on double-click (remembered between launches)
try {
  if (localStorage.getItem('previewOnDblclick') === '0') elPreviewOnDblclick.checked = false;
} catch (_) { /* storage unavailable: keep the default (on) */ }
elPreviewOnDblclick.addEventListener('change', () => {
  try { localStorage.setItem('previewOnDblclick', elPreviewOnDblclick.checked ? '1' : '0'); } catch (_) {}
});

// Show hidden files
elShowHidden.addEventListener('change', (e) => {
  showHidden = e.target.checked;
  renderPhoneTable();
  renderMacTable();
});

// Global Shortcuts: Cmd-A, Esc, Enter
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    phoneSelection.clear();
    localSelection.clear();
    renderPhoneTable();
    renderMacTable();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    e.preventDefault();
    if (activePane === 'phone') {
      filterEntries(phoneEntries).forEach(item => phoneSelection.add(item.name));
      renderPhoneTable();
    } else {
      filterEntries(localEntries).forEach(item => localSelection.add(item.name));
      renderMacTable();
    }
  } else if (e.key === 'Enter') {
    if (activePane === 'phone' && phoneSelection.size === 1) {
      const selectedName = Array.from(phoneSelection)[0];
      const entry = phoneEntries.find(i => i.name === selectedName);
      if (entry) openPhoneEntry(entry);
    } else if (activePane === 'mac' && localSelection.size === 1) {
      const selectedName = Array.from(localSelection)[0];
      const entry = localEntries.find(i => i.name === selectedName);
      if (entry) openMacEntry(entry);
    }
  }
});

// Focus tracking
elPhonePane.addEventListener('focusin', () => { activePane = 'phone'; });
elMacPane.addEventListener('focusin', () => { activePane = 'mac'; });

// Drag and Drop Logic
function getSelectedPhoneItems() {
  return phoneEntries.filter(e => phoneSelection.has(e.name));
}

function getSelectedLocalItems() {
  return localEntries.filter(e => localSelection.has(e.name));
}

function handlePhoneDragStart(e, entry) {
  if (!phoneSelection.has(entry.name)) {
    phoneSelection.clear();
    phoneSelection.add(entry.name);
    renderPhoneTable();
  }

  const selectedItems = getSelectedPhoneItems();
  const currentKey = getSelectionKey(currentPhoneDir, phoneSelection);

  // Already copied to the Mac ("Ready"): start the native drag right now. macOS only starts a drag while the
  // mouse button is still down, so nothing here may wait on an async call.
  if (preparedFinder.key === currentKey && preparedFinder.localPaths && preparedFinder.localPaths.length > 0) {
    e.preventDefault();
    window.api.startNativeDrag({ localPaths: preparedFinder.localPaths });
    return;
  }

  // HTML5 drag between the two panes
  e.dataTransfer.setData('application/x-phone-explorer-phone', JSON.stringify({
    sourceDir: currentPhoneDir,
    items: selectedItems
  }));
  e.dataTransfer.effectAllowed = 'copy';
}

function handlePhoneDragEnd(e) {
  // If dragged out of window and released (dropEffect === 'none'), trigger Prepare for Finder
  if (e.dataTransfer.dropEffect === 'none' && phoneSelection.size > 0) {
    triggerPrepareForFinder();
  }
}

function handleMacDragStart(e, entry) {
  if (!localSelection.has(entry.name)) {
    localSelection.clear();
    localSelection.add(entry.name);
    renderMacTable();
  }

  const selectedItems = getSelectedLocalItems();
  e.dataTransfer.setData('application/x-phone-explorer-mac', JSON.stringify({
    sourceDir: currentLocalDir,
    items: selectedItems
  }));
  e.dataTransfer.effectAllowed = 'copy';
}

// Drop on Mac Pane
elMacPane.addEventListener('dragover', (e) => {
  e.preventDefault();
  elMacPane.classList.add('drop-active');
  e.dataTransfer.dropEffect = 'copy';
});

elMacPane.addEventListener('dragleave', (e) => {
  if (!elMacPane.contains(e.relatedTarget)) {
    elMacPane.classList.remove('drop-active');
  }
});

elMacPane.addEventListener('drop', (e) => {
  elMacPane.classList.remove('drop-active');
  handleDropOnMac(e, currentLocalDir);
});

// A prepared selection is dragged as a native (Finder-style) drag. If it is dropped back onto this window,
// the drop carries only the cached copies' paths, not the phone data, so recognise it by those paths.
function droppedFilePaths(e) {
  const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
  return files.map((f) => window.api.getPathForFile(f)).filter(Boolean);
}

function isPreparedDrop(paths) {
  const prepared = preparedFinder.localPaths;
  return !!prepared && paths.length > 0 && paths.every((p) => prepared.includes(p));
}

async function copyPreparedToMac(targetDestDir) {
  await startTransferJob({
    direction: 'pull',
    sourceDir: preparedFinder.sourceDir,
    destDir: targetDestDir,
    items: preparedFinder.items
  });
  navigateToMac(currentLocalDir);
}

async function handleDropOnMac(e, targetDestDir) {
  e.preventDefault();
  e.stopPropagation();

  if (!e.dataTransfer.getData('application/x-phone-explorer-phone') && isPreparedDrop(droppedFilePaths(e))) {
    await copyPreparedToMac(targetDestDir);
    return;
  }

  const phoneData = e.dataTransfer.getData('application/x-phone-explorer-phone');
  if (phoneData) {
    const { sourceDir, items } = JSON.parse(phoneData);
    await startTransferJob({
      direction: 'pull',
      sourceDir,
      destDir: targetDestDir,
      items
    });
    navigateToMac(currentLocalDir);
  }
}

// Drop on Phone Pane
elPhonePane.addEventListener('dragover', (e) => {
  e.preventDefault();
  elPhonePane.classList.add('drop-active');
  e.dataTransfer.dropEffect = 'copy';
});

elPhonePane.addEventListener('dragleave', (e) => {
  if (!elPhonePane.contains(e.relatedTarget)) {
    elPhonePane.classList.remove('drop-active');
  }
});

elPhonePane.addEventListener('drop', async (e) => {
  elPhonePane.classList.remove('drop-active');
  e.preventDefault();
  e.stopPropagation();

  // Dropping from Mac Pane
  const macData = e.dataTransfer.getData('application/x-phone-explorer-mac');
  if (macData) {
    const { sourceDir, items } = JSON.parse(macData);
    await startTransferJob({
      direction: 'push',
      sourceDir,
      destDir: currentPhoneDir,
      items
    });
    navigateToPhone(currentPhoneDir);
    return;
  }

  // A prepared phone selection dropped back on the phone pane: nothing to do
  if (isPreparedDrop(droppedFilePaths(e))) return;

  // Dropping from Finder
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const items = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i];
      const resolvedPath = window.api.getPathForFile(file);
      if (resolvedPath) {
        items.push({
          path: resolvedPath,
          name: file.name,
          size: file.size,
          isDir: false // will be resolved if dir
        });
      }
    }

    if (items.length > 0) {
      await startTransferJob({
        direction: 'push',
        sourceDir: '',
        destDir: currentPhoneDir,
        items
      });
      navigateToPhone(currentPhoneDir);
    }
  }
});

// Double-click / Enter: folders open; files are previewed (phone) or opened (Mac)
function openPhoneEntry(entry) {
  if (entry.isDir) {
    navigateToPhone(currentPhoneDir === '/' ? `/${entry.name}` : `${currentPhoneDir}/${entry.name}`);
  } else if (elPreviewOnDblclick.checked) {
    previewPhoneFile(entry);
  }
}

function openMacEntry(entry) {
  const fullPath = currentLocalDir.endsWith('/') ? `${currentLocalDir}${entry.name}` : `${currentLocalDir}/${entry.name}`;
  if (entry.isDir) {
    navigateToMac(fullPath);
  } else if (elPreviewOnDblclick.checked) {
    window.api.openLocalFile(fullPath).then((res) => {
      if (res && res.revealed) elTransferLabel.textContent = `${entry.name} can run code, so it was shown in Finder instead of opened`;
      else if (res && res.error) elTransferLabel.textContent = `Could not open ${entry.name}: ${res.error}`;
    });
  }
}

// Copy a phone file to a temp folder, then open it with its default app. The copy is deleted later (see main.js).
async function previewPhoneFile(entry) {
  if (isTransferring) {
    elTransferLabel.textContent = 'Wait for the current transfer to finish, then try again';
    return;
  }
  isTransferring = true;
  elBtnCancelTransfer.disabled = false;
  elTransferProgressBar.value = 0;
  elTransferLabel.textContent = `Opening ${entry.name}...`;
  elTransferSpeed.textContent = '';

  try {
    const res = await window.api.previewPhoneFile({ sourceDir: currentPhoneDir, entry });
    if (res.cancelled) {
      elTransferLabel.textContent = 'Preview cancelled';
    } else if (res.busy) {
      elTransferLabel.textContent = 'Wait for the current transfer to finish, then try again';
    } else if (res.error) {
      elTransferLabel.textContent = `Could not open ${entry.name}: ${res.error}`;
    } else if (res.revealed) {
      elTransferLabel.textContent = `${entry.name} can run code, so it was shown in Finder instead of opened`;
    } else {
      elTransferLabel.textContent = `Opened ${entry.name} (temporary copy, deleted later)`;
    }
  } catch (err) {
    elTransferLabel.textContent = `Error: ${err.message}`;
  } finally {
    isTransferring = false;
    elBtnCancelTransfer.disabled = true;
    elTransferSpeed.textContent = '';
  }
}

// Transfer execution and UI updates
async function startTransferJob(options) {
  if (isTransferring) return;
  isTransferring = true;
  elBtnCancelTransfer.disabled = false;
  elTransferProgressBar.value = 0;
  elTransferLabel.textContent = 'Starting transfer...';
  elTransferSpeed.textContent = '';

  try {
    const res = await window.api.startTransfer(options);
    if (res.cancelled) {
      elTransferLabel.textContent = 'Transfer cancelled';
    } else if (res.success) {
      elTransferLabel.textContent = `Completed (${res.filesDone} files)`;
    } else {
      elTransferLabel.textContent = `Completed with ${res.errors.length} errors`;
    }
  } catch (err) {
    elTransferLabel.textContent = `Error: ${err.message}`;
  } finally {
    isTransferring = false;
    elBtnCancelTransfer.disabled = true;
    elTransferSpeed.textContent = '';
  }
}

// Prepare for Finder
async function triggerPrepareForFinder() {
  const selectedItems = getSelectedPhoneItems();
  if (selectedItems.length === 0) return;

  const currentKey = getSelectionKey(currentPhoneDir, phoneSelection);
  isTransferring = true;
  elBtnCancelTransfer.disabled = false;
  elTransferProgressBar.value = 0;
  elTransferLabel.textContent = 'Preparing for Finder...';
  elTransferSpeed.textContent = '';

  try {
    const res = await window.api.prepareForFinder({
      sourceDir: currentPhoneDir,
      items: selectedItems
    });

    if (res.cancelled) {
      elTransferLabel.textContent = 'Preparation cancelled';
    } else if (res.ready) {
      preparedFinder = { key: currentKey, localPaths: res.localPaths || null, sourceDir: currentPhoneDir, items: selectedItems };
      elTransferLabel.textContent = 'Ready — drag the selection to Finder now.';
    }
  } catch (err) {
    elTransferLabel.textContent = `Error: ${err.message}`;
  } finally {
    isTransferring = false;
    elBtnCancelTransfer.disabled = true;
  }
}

elBtnPrepareFinder.addEventListener('click', triggerPrepareForFinder);

// Toolbar Buttons
elBtnCopyToMac.addEventListener('click', async () => {
  const selectedItems = getSelectedPhoneItems();
  if (selectedItems.length === 0) return;
  await startTransferJob({
    direction: 'pull',
    sourceDir: currentPhoneDir,
    destDir: currentLocalDir,
    items: selectedItems
  });
  navigateToMac(currentLocalDir);
});

elBtnCopyToPhone.addEventListener('click', async () => {
  const selectedItems = getSelectedLocalItems();
  if (selectedItems.length === 0) return;
  await startTransferJob({
    direction: 'push',
    sourceDir: currentLocalDir,
    destDir: currentPhoneDir,
    items: selectedItems
  });
  navigateToPhone(currentPhoneDir);
});

elBtnCancelTransfer.addEventListener('click', async () => {
  await window.api.cancelTransfer();
});

// Transfer Progress Listener
window.api.onTransferProgress((data) => {
  elTransferLabel.textContent = data.label || 'Transferring...';
  if (data.bytesTotal > 0) {
    const pct = Math.floor((data.bytesDone / data.bytesTotal) * 100);
    elTransferProgressBar.value = pct;
  }
  if (data.speed) {
    elTransferSpeed.textContent = `${formatBytes(data.speed)}/s`;
  }
});

// Device status polling
async function pollDeviceStatus() {
  try {
    const status = await window.api.getDeviceStatus();
    elDeviceStatus.className = `status-badge status-${status.state}`;
    elDeviceStatusText.textContent = status.message;
  } catch (_) {
    elDeviceStatus.className = 'status-badge status-none';
    elDeviceStatusText.textContent = 'Plug in your phone with a USB cable';
  }
}

// Initial setup
async function init() {
  const startPaths = await window.api.getStartPaths();
  homeDir = startPaths.homeDir;
  currentLocalDir = startPaths.localStart;
  currentPhoneDir = startPaths.phoneStart;

  await pollDeviceStatus();
  setInterval(pollDeviceStatus, 2000);

  await navigateToLocalStart();
  await navigateToPhoneStart();
}

async function navigateToLocalStart() {
  await navigateToMac(currentLocalDir);
}

async function navigateToPhoneStart() {
  await navigateToPhone(currentPhoneDir);
}

init();
