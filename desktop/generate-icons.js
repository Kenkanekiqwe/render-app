const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const appIconSource = path.join(root, 'img', 'prilozhenie.png');
const fallbackIconSource = path.join(root, 'img', 'logo.png');

function resolveIconSource() {
  const candidate = fs.existsSync(appIconSource) ? appIconSource : fallbackIconSource;
  if (!fs.existsSync(candidate)) {
    console.error('Icon source not found in img/prilozhenie.png or img/logo.png');
    process.exit(1);
  }

  const header = fs.readFileSync(candidate).subarray(0, 4);
  const isJpeg = header[0] === 0xff && header[1] === 0xd8;
  const isPng = header[0] === 0x89 && header[1] === 0x50;

  if (isJpeg) {
    const jpegPath = path.join(iconsDir, 'source.jpg');
    fs.mkdirSync(iconsDir, { recursive: true });
    fs.copyFileSync(candidate, jpegPath);
    return jpegPath;
  }

  if (isPng) {
    return candidate;
  }

  console.error(`Unsupported icon format: ${candidate}`);
  process.exit(1);
}

fs.mkdirSync(iconsDir, { recursive: true });
const sourceIcon = resolveIconSource();

execSync(`npx tauri icon "${sourceIcon}"`, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

console.log(`Icons generated from ${sourceIcon}`);
