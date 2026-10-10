const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const localApp = path.join(process.env.LOCALAPPDATA || '', 'Render');
const source = path.join(__dirname, '..', 'client', 'build');
const targets = [
  path.join(localApp, 'client', 'build'),
  path.join(localApp, 'build'),
];

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(source)) {
  console.error('client/build not found');
  process.exit(1);
}

for (const target of targets) {
  copyRecursive(source, target);
  console.log(`Desktop assets copied to ${target}`);
}

const exePath = path.join(localApp, 'Render.exe');
const vbsPath = path.join(localApp, 'Render.vbs');
const launcherVbs = [
  'Set shell = CreateObject("WScript.Shell")',
  'appDir = Replace(WScript.ScriptFullName, "Render.vbs", "")',
  'If Right(appDir, 1) <> "\\" Then appDir = appDir & "\\"',
  'shell.CurrentDirectory = appDir',
  'shell.Run Chr(34) & appDir & "Render.exe" & Chr(34), 0, False',
].join('\r\n');

fs.writeFileSync(vbsPath, launcherVbs, 'utf8');
console.log(`Created ${vbsPath}`);

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
console.log(`Created ${startBat}`);

const projectStartBat = path.join(__dirname, '..', 'dist', 'Start Render.bat');
fs.mkdirSync(path.dirname(projectStartBat), { recursive: true });
fs.writeFileSync(
  projectStartBat,
  [
    '@echo off',
    'cd /d "%LOCALAPPDATA%\\Render"',
    'if not exist "%LOCALAPPDATA%\\Render\\Render.exe" (',
    '  echo Render is not installed. Run: npm run build:desktop-exe',
    '  pause',
    '  exit /b 1',
    ')',
    'start "" wscript.exe "%LOCALAPPDATA%\\Render\\Render.vbs"',
  ].join('\r\n'),
  'utf8'
);

const rceditBin = path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.ico');
if (fs.existsSync(exePath) && fs.existsSync(rceditBin)) {
  try {
    const rceditArgs = [exePath, '--set-version-string', 'ProductName', 'Render'];
    if (fs.existsSync(iconPath)) {
      rceditArgs.push('--set-icon', iconPath);
    }
    execFileSync(rceditBin, rceditArgs, {
      stdio: 'ignore',
    });
    if (fs.existsSync(iconPath)) {
      console.log(`Applied icon to ${exePath}`);
    }
  } catch {
    // optional
  }
}
