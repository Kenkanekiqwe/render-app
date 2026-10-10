const http = require('http');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

process.env.RENDER_DESKTOP = '1';
process.env.RENDER_SILENT = '1';
process.env.PORT = process.env.PORT || '5000';

const { startServer } = require('../server/index.js');

const execDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
process.chdir(execDir);

const APP_URL = `http://127.0.0.1:${process.env.PORT}`;
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

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await request(`${APP_URL}/api/health`);
      if (health.statusCode && health.statusCode < 500) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function killPort(port) {
  if (process.platform !== 'win32') return;

  const myPid = String(process.pid);

  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();

    output.split('\n').forEach((line) => {
      if (!line.includes('LISTENING')) return;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0' && pid !== myPid) pids.add(pid);
    });

    pids.forEach((pid) => {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    });
  } catch {
    // nothing listening
  }
}

function findEdgeExecutable() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function openAppWindow() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const edgePath = findEdgeExecutable();
  if (edgePath) {
    const child = spawn(
      edgePath,
      [
        `--app=${APP_URL}`,
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
    writeLog(`Opened Edge app window: ${APP_URL}`);
    return true;
  }

  spawn('cmd', ['/c', 'start', 'Render', APP_URL], {
    detached: true,
    stdio: 'ignore',
    shell: true,
  }).unref();
  writeLog(`Opened default browser: ${APP_URL}`);
  return true;
}

async function main() {
  writeLog(`Starting Render local mode from ${execDir}`);

  killPort(process.env.PORT);
  await new Promise((resolve) => setTimeout(resolve, 300));

  await startServer();
  writeLog('Server started');

  const ready = await waitForHealth();
  if (!ready) {
    writeLog('Server health check failed');
    throw new Error('Server health check failed');
  }

  openAppWindow();
}

main().catch((error) => {
  writeLog(`Fatal: ${error.message}`);
  process.exit(1);
});
