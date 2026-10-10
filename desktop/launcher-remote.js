const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const execDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || execDir, 'Render', 'WebView');
const LOG_FILE = path.join(process.env.LOCALAPPDATA || execDir, 'Render', 'launch.log');

function writeLog(message) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // ignore
  }
}

function loadRenderConfig() {
  const candidates = [
    path.join(execDir, 'render-config.json'),
    path.join(__dirname, '..', 'src-tauri', 'render-config.json'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {
      // try next
    }
  }

  return null;
}

function resolveRemoteUrl() {
  const fromEnv = String(process.env.RENDER_PUBLIC_URL || '').trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }

  const config = loadRenderConfig();
  if (!config || config.useLocalSidecar) {
    return null;
  }

  const url = String(config.windowUrl || config.publicUrl || '').trim();
  return url ? url.replace(/\/+$/, '') : null;
}

function findEdgeExecutable() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function openAppWindow(appUrl) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const edgePath = findEdgeExecutable();
  if (edgePath) {
    const child = spawn(
      edgePath,
      [
        `--app=${appUrl}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--new-window',
        '--no-first-run',
        '--disable-extensions',
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }
    );
    child.unref();
    writeLog(`Opened Edge app window: ${appUrl}`);
    return;
  }

  spawn('cmd', ['/c', 'start', 'Render', appUrl], {
    detached: true,
    stdio: 'ignore',
    shell: true,
  }).unref();
  writeLog(`Opened default browser: ${appUrl}`);
}

function main() {
  const appUrl = resolveRemoteUrl();
  if (!appUrl) {
    writeLog('Remote URL not configured');
    process.exit(1);
  }

  writeLog(`Render remote mode: ${appUrl}`);
  openAppWindow(appUrl);
}

main();
