const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const capabilitiesPath = path.join(root, 'src-tauri', 'capabilities', 'default.json');
const renderConfigPath = path.join(root, 'src-tauri', 'render-config.json');
const sidecarBinDir = path.join(root, 'src-tauri', 'bin');

function normalizePublicUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  return `http://${value.replace(/\/+$/, '')}`;
}

function derivePublicUrl() {
  const explicit = normalizePublicUrl(process.env.RENDER_PUBLIC_URL);
  if (explicit) return explicit;

  const host = String(process.env.RENDER_HOST || '').trim();
  const port = String(process.env.RENDER_PUBLIC_PORT || process.env.PORT || '80').trim();

  if (!host || host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost') {
    return null;
  }

  const portNum = Number(port);
  const defaultPort = portNum === 80 ? '' : `:${portNum}`;
  return normalizePublicUrl(`http://${host}${defaultPort}`);
}

function localDevUrl() {
  const port = process.env.DESKTOP_PORT || '5000';
  return `http://127.0.0.1:${port}`;
}

function removeSidecarArtifacts() {
  if (!fs.existsSync(sidecarBinDir)) return;

  for (const entry of fs.readdirSync(sidecarBinDir)) {
    if (entry.includes('render-server')) {
      fs.rmSync(path.join(sidecarBinDir, entry), { force: true });
    }
  }
}

function ensureRemoteFrontendStub() {
  const buildDir = path.join(root, 'client', 'build');
  const indexPath = path.join(buildDir, 'index.html');
  if (fs.existsSync(indexPath)) return;

  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(
    indexPath,
    '<!doctype html><html><head><meta charset="utf-8"><title>Render</title></head><body></body></html>\n',
    'utf8'
  );
}

const forceLocal = process.env.RENDER_DESKTOP_LOCAL === '1';
const publicUrl = forceLocal ? null : derivePublicUrl();
const useLocalSidecar = forceLocal || !publicUrl;
const windowUrl = publicUrl || localDevUrl();

if (!useLocalSidecar) {
  removeSidecarArtifacts();
  ensureRemoteFrontendStub();
}

const renderConfig = {
  publicUrl,
  useLocalSidecar,
  windowUrl,
};

fs.writeFileSync(renderConfigPath, `${JSON.stringify(renderConfig, null, 2)}\n`);

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
// Low-RAM WebView2 profile: fewer features, smaller caches, 1 renderer.
const browserArgs = [
  '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,TranslateUI,BackForwardCache,InterestFeedContentSuggestions,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--disable-extensions',
  '--metrics-recording-only',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-pings',
  '--disk-cache-size=33554432',
  '--media-cache-size=16777216',
  '--renderer-process-limit=1',
  '--js-flags=--max-old-space-size=192',
  '--disable-gpu-shader-disk-cache',
].join(' ');
const lowRam = process.env.RENDER_LOW_RAM !== '0';
const origin = windowUrl.replace(/\/+$/, '');

tauriConf.build.devUrl = windowUrl;
tauriConf.build.beforeBuildCommand = 'node desktop/configure-remote.js';

const mainWindow = {
  ...(tauriConf.app.windows.find((item) => item.label === 'main') || tauriConf.app.windows[0] || {}),
  label: 'main',
  title: 'Render',
  url: origin,
  additionalBrowserArgs: browserArgs,
};

tauriConf.app.windows = lowRam
  ? [mainWindow]
  : [
      mainWindow,
      {
        label: 'mini-player',
        title: 'Render',
        url: `${origin}/?mini=1`,
        width: 280,
        height: 86,
        minWidth: 240,
        minHeight: 80,
        maxWidth: 360,
        maxHeight: 110,
        resizable: false,
        decorations: false,
        alwaysOnTop: true,
        visible: false,
        skipTaskbar: true,
        shadow: true,
        focus: false,
        additionalBrowserArgs: browserArgs,
      },
    ];
delete tauriConf.bundle.externalBin;
tauriConf.bundle.resources = {};

fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

const remoteUrls = ['http://127.0.0.1:5000', 'http://localhost:5000'];
if (publicUrl) {
  remoteUrls.push(publicUrl, `${publicUrl}/*`);
}

const capabilities = {
  $schema: '../gen/schemas/desktop-schema.json',
  identifier: 'default',
  description: 'Default capabilities for Render',
  windows: ['main', 'mini-player'],
  remote: {
    urls: remoteUrls,
  },
  permissions: [
    'core:default',
    'core:window:allow-minimize',
    'core:window:allow-maximize',
    'core:window:allow-unmaximize',
    'core:window:allow-toggle-maximize',
    'core:window:allow-is-maximized',
    'core:window:allow-close',
    'core:window:allow-start-dragging',
    'core:window:allow-hide',
    'core:window:allow-show',
    'core:window:allow-set-focus',
    'core:window:allow-set-always-on-top',
    'core:window:allow-unminimize',
    'core:webview:allow-create-webview-window',
    'core:webview:allow-create-webview',
    'opener:default',
    'allow-sync-global-keybinds',
    'allow-discord-presence',
    'global-shortcut:allow-is-registered',
    'global-shortcut:allow-register',
    'global-shortcut:allow-unregister',
    'global-shortcut:allow-unregister-all',
  ],
};

fs.writeFileSync(capabilitiesPath, `${JSON.stringify(capabilities, null, 2)}\n`);

console.log('Render desktop config:');
console.log(' - mode:', useLocalSidecar ? 'local dev (npm run dev)' : 'remote WebView only');
console.log(' - window url:', windowUrl);
console.log(' - sidecar: disabled');

module.exports = { renderConfig, useLocalSidecar };

