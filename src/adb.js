const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Resolves the path to the adb binary.
 * Priority:
 * 1. process.env.ADB_PATH
 * 2. ~/Library/Android/sdk/platform-tools/adb
 * 3. /opt/homebrew/bin/adb
 * 4. /usr/local/bin/adb
 * 5. 'adb' (system PATH)
 */
function findAdb() {
  if (process.env.ADB_PATH && process.env.ADB_PATH.trim() !== '') {
    const customPath = process.env.ADB_PATH.trim();
    if (fs.existsSync(customPath)) {
      try {
        // Ensure fake-adb or custom adb is executable
        const stat = fs.statSync(customPath);
        if ((stat.mode & 0o111) === 0) {
          fs.chmodSync(customPath, stat.mode | 0o755);
        }
      } catch (_) {}
    }
    return customPath;
  }

  const standardLocations = [
    path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb'
  ];

  for (const loc of standardLocations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  return 'adb';
}

/**
 * Checks whether the resolved adb binary is available.
 */
function isAdbAvailable() {
  const binary = findAdb();
  if (path.isAbsolute(binary)) {
    return fs.existsSync(binary);
  }
  // If fallback to 'adb', test if it can be found in PATH
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, binary);
    if (fs.existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Escapes a remote path using POSIX single-quote escaping.
 * Handles spaces, quotes, $, backticks, unicode, and newlines safely.
 */
function shellQuote(str) {
  if (str === null || str === undefined) return "''";
  return "'" + String(str).replace(/'/g, "'\\''") + "'";
}

/**
 * Runs an adb command using execFile with an argument array.
 * Never uses a shell string.
 */
function run(args, options = {}) {
  const adbBin = findAdb();
  const env = { ...process.env, ...(options.env || {}) };

  return new Promise((resolve, reject) => {
    execFile(adbBin, args, {
      env,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      timeout: options.timeout || 30000,
      cwd: options.cwd || process.cwd()
    }, (error, stdout, stderr) => {
      if (error) {
        const enhancedError = new Error(stderr ? stderr.trim() : error.message);
        enhancedError.code = error.code;
        enhancedError.stdout = stdout;
        enhancedError.stderr = stderr;
        return reject(enhancedError);
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/**
 * Spawns an adb command using spawn with an argument array.
 */
function spawnAdb(args, options = {}) {
  const adbBin = findAdb();
  const env = { ...process.env, ...(options.env || {}) };
  return spawn(adbBin, args, { env, cwd: options.cwd || process.cwd() });
}

/**
 * Parses output from `adb devices -l` (or `adb devices`).
 * Device states: 'device', 'unauthorized', 'offline'.
 * If no devices are attached, primaryState is 'none'.
 */
function parseDevices(output) {
  if (!output || typeof output !== 'string') {
    return { devices: [], primaryState: 'none', primaryDevice: null };
  }

  const lines = output.split('\n');
  const devices = [];
  let headerSeen = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('List of devices attached')) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen && !line.includes('\t') && !line.includes(' ')) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length >= 2) {
      const serial = tokens[0];
      const state = tokens[1]; // 'device', 'unauthorized', 'offline'
      const device = {
        serial,
        state,
        product: '',
        model: '',
        device: '',
        transportId: ''
      };

      for (let i = 2; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('product:')) device.product = token.slice(8);
        else if (token.startsWith('model:')) device.model = token.slice(6);
        else if (token.startsWith('device:')) device.device = token.slice(7);
        else if (token.startsWith('transport_id:')) device.transportId = token.slice(13);
      }

      devices.push(device);
    }
  }

  let primaryState = 'none';
  let primaryDevice = null;

  if (devices.length > 0) {
    primaryDevice = devices[0];
    primaryState = primaryDevice.state;
  }

  return {
    devices,
    primaryState,
    primaryDevice
  };
}

module.exports = {
  findAdb,
  isAdbAvailable,
  shellQuote,
  run,
  spawnAdb,
  parseDevices
};
