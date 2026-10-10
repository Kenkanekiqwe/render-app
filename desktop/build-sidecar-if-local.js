const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const configPath = path.join(__dirname, '..', 'src-tauri', 'render-config.json');

if (!fs.existsSync(configPath)) {
  require('./configure-remote');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (config.useLocalSidecar) {
  execSync('node desktop/build-sidecar.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });
} else {
  console.log('Skipping local sidecar build (remote host mode).');
}
