const fs = require('fs');
const os = require('os');
const path = require('path');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function findReleaseRoot() {
  const candidates = [
    path.join(process.cwd(), 'src-tauri', 'target', 'release'),
    path.join(process.cwd(), 'src-tauri', 'src-tauri', 'target', 'release'),
    process.env.CARGO_TARGET_DIR && path.join(process.env.CARGO_TARGET_DIR, 'release'),
    path.join(
      os.tmpdir(),
      'cursor-sandbox-cache',
      '80d4b8a2031374545de2f0523c81b5f3',
      'cargo-target',
      'release'
    ),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'render.exe')));
}

const sourceRoot = findReleaseRoot();

if (!sourceRoot) {
  console.error('Tauri release build not found. Run: npx tauri build');
  process.exit(1);
}

const renderConfigPath = path.join(process.cwd(), 'src-tauri', 'render-config.json');
const renderConfig = JSON.parse(fs.readFileSync(renderConfigPath, 'utf8'));
const useLocalSidecar = Boolean(renderConfig.useLocalSidecar);

const distRoot = path.join(process.cwd(), 'dist');
const portableDir = path.join(distRoot, 'portable');

fs.mkdirSync(distRoot, { recursive: true });
fs.mkdirSync(portableDir, { recursive: true });

const installerSource = path.join(sourceRoot, 'bundle', 'nsis', 'Render_1.0.0_x64-setup.exe');
if (!fs.existsSync(installerSource)) {
  console.error('NSIS installer not found:', installerSource);
  process.exit(1);
}

const installerDest = path.join(distRoot, 'Render_1.0.0_x64-setup.exe');
fs.copyFileSync(installerSource, installerDest);

fs.copyFileSync(path.join(sourceRoot, 'render.exe'), path.join(portableDir, 'Render.exe'));
fs.copyFileSync(renderConfigPath, path.join(portableDir, 'render-config.json'));

if (useLocalSidecar) {
  const sidecarSource = [
    path.join(sourceRoot, 'render-server.exe'),
    path.join(process.cwd(), 'src-tauri', 'bin', 'render-server-x86_64-pc-windows-msvc.exe'),
  ].find((candidate) => fs.existsSync(candidate));

  if (sidecarSource) {
    fs.copyFileSync(sidecarSource, path.join(portableDir, 'render-server.exe'));
  }

  const clientBuild = path.join(process.cwd(), 'client', 'build');
  if (fs.existsSync(path.join(clientBuild, 'index.html'))) {
    copyDir(clientBuild, path.join(portableDir, 'client', 'build'));
  }
}

console.log('');
console.log('Build ready:');
console.log(' - mode:', useLocalSidecar ? 'local sidecar' : 'remote only');
console.log(' - Installer:', installerDest);
console.log(' - Portable: ', portableDir);
console.log('');
