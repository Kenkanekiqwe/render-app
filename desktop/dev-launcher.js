const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'src-tauri', 'render-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (config.useLocalSidecar) {
  require('./launcher');
} else {
  require('./launcher-remote');
}
