const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const localApp = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Render');
const stage = path.join(os.tmpdir(), 'render-pkg-build');
const projectDist = path.join(root, 'dist');

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function run(command, cwd) {
  execSync(command, { cwd, stdio: 'inherit', shell: true });
}

function copyDistFiles(targetDir) {
  const files = ['Render.exe', 'Render.vbs', 'Start Render.bat', 'render-config.json'];
  for (const file of files) {
    const src = path.join(localApp, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetDir, file));
    }
  }

  const clientBuild = path.join(localApp, 'client', 'build');
  if (fs.existsSync(path.join(clientBuild, 'index.html'))) {
    copyDir(path.join(localApp, 'client'), path.join(targetDir, 'client'));
    copyDir(path.join(localApp, 'build'), path.join(targetDir, 'build'));
  }
}

require('./configure-remote');

const renderConfigPath = path.join(root, 'src-tauri', 'render-config.json');
const renderConfig = JSON.parse(fs.readFileSync(renderConfigPath, 'utf8'));
const useLocalSidecar = Boolean(renderConfig.useLocalSidecar);
const launcherEntry = useLocalSidecar ? 'desktop/launcher.js' : 'desktop/launcher-remote.js';

console.log('Building desktop launcher...');
console.log(' - mode:', useLocalSidecar ? 'local server' : 'remote host only (no Node sidecar)');

if (useLocalSidecar) {
  console.log('Building React app...');
  run('npm run build', root);
} else {
  console.log('Skipping client build (remote mode).');
}

console.log('Preparing pkg stage...');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

if (useLocalSidecar) {
  for (const item of ['desktop', 'server', 'package.json', 'package-lock.json']) {
    copyDir(path.join(root, item), path.join(stage, item));
  }
  copyDir(path.join(root, 'node_modules'), path.join(stage, 'node_modules'));
} else {
  fs.mkdirSync(path.join(stage, 'desktop'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'desktop', 'launcher-remote.js'),
    path.join(stage, 'desktop', 'launcher-remote.js')
  );
}

fs.copyFileSync(renderConfigPath, path.join(stage, 'render-config.json'));

console.log(`Packaging Render.exe from ${launcherEntry}...`);
run(`npx pkg ${launcherEntry} --targets node18-win-x64 --output Render.exe`, stage);

fs.mkdirSync(localApp, { recursive: true });
fs.copyFileSync(path.join(stage, 'Render.exe'), path.join(localApp, 'Render.exe'));
fs.copyFileSync(renderConfigPath, path.join(localApp, 'render-config.json'));

if (useLocalSidecar) {
  require('./post-build');
} else {
  const vbsPath = path.join(localApp, 'Render.vbs');
  const launcherVbs = [
    'Set shell = CreateObject("WScript.Shell")',
    'appDir = Replace(WScript.ScriptFullName, "Render.vbs", "")',
    'If Right(appDir, 1) <> "\\" Then appDir = appDir & "\\"',
    'shell.CurrentDirectory = appDir',
    'shell.Run Chr(34) & appDir & "Render.exe" & Chr(34), 0, False',
  ].join('\r\n');
  fs.writeFileSync(vbsPath, launcherVbs, 'utf8');

  const startBat = path.join(localApp, 'Start Render.bat');
  fs.writeFileSync(
    startBat,
    [
      '@echo off',
      'cd /d "%LOCALAPPDATA%\\Render"',
      'start "" wscript.exe "%LOCALAPPDATA%\\Render\\Render.vbs"',
    ].join('\r\n'),
    'utf8'
  );
}

fs.mkdirSync(projectDist, { recursive: true });
copyDistFiles(projectDist);

console.log('Desktop build complete:');
console.log(' -', path.join(localApp, 'Render.exe'));
console.log(' -', path.join(projectDist, 'Start Render.bat'));
