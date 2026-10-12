const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'public', 'audio-dsp');
fs.mkdirSync(outputDir, { recursive: true });

const assets = [
  ['@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js', 'rnnoiseWorklet.js'],
  ['@sapphi-red/web-noise-suppressor/rnnoise.wasm', 'rnnoise.wasm'],
  ['@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm', 'rnnoise_simd.wasm'],
];

for (const [packagePath, outputName] of assets) {
  const source = require.resolve(packagePath);
  fs.copyFileSync(source, path.join(outputDir, outputName));
}

console.log('Copied RNNoise AudioWorklet and WASM assets to public/audio-dsp');
