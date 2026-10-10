const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const stage = path.join(os.tmpdir(), 'render-sidecar-build');
const binDir = path.join(root, 'src-tauri', 'bin');
const outputName = 'render-server-x86_64-pc-windows-msvc.exe';

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });

for (const item of ['desktop', 'server', 'package.json', 'package-lock.json']) {
  copyDir(path.join(root, item), path.join(stage, item));
}

copyDir(path.join(root, 'node_modules'), path.join(stage, 'node_modules'));
copyDir(path.join(root, 'client', 'build'), path.join(stage, 'client', 'build'));

execSync(
  'npx pkg desktop/server-sidecar.js --targets node18-win-x64 --output render-server.exe',
  { cwd: stage, stdio: 'inherit', shell: true }
);

fs.copyFileSync(path.join(stage, 'render-server.exe'), path.join(binDir, outputName));
console.log('Sidecar built:', path.join(binDir, outputName));
