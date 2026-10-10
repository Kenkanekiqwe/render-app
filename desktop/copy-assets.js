const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'client', 'build');
const target = path.join(__dirname, '..', 'dist', 'client', 'build');

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

copyRecursive(source, target);
console.log(`Desktop assets copied to ${target}`);
