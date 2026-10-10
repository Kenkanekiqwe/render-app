const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const target = path.join(root, 'src-tauri', 'target');

execSync('npx tauri build', {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    CARGO_TARGET_DIR: target,
  },
});
