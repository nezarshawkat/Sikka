import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const iconSource = join(scriptDir, 'sikka-app-icon.b64');
const androidRoot = join(repoRoot, 'artifacts', 'sikka', 'android', 'app', 'src', 'main');
const resRoot = join(androidRoot, 'res');
const iconPng = Buffer.from(readFileSync(iconSource, 'utf8').replace(/\s+/g, ''), 'base64');

const densityFolders = [
  'mipmap-mdpi',
  'mipmap-hdpi',
  'mipmap-xhdpi',
  'mipmap-xxhdpi',
  'mipmap-xxxhdpi',
];

for (const folder of densityFolders) {
  const dir = join(resRoot, folder);
  mkdirSync(dir, { recursive: true });
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    writeFileSync(join(dir, name), iconPng);
  }
}

const drawableDir = join(resRoot, 'drawable');
mkdirSync(drawableDir, { recursive: true });
writeFileSync(join(drawableDir, 'sikka_logo.png'), iconPng);

const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;

const adaptiveDir = join(resRoot, 'mipmap-anydpi-v26');
mkdirSync(adaptiveDir, { recursive: true });
writeFileSync(join(adaptiveDir, 'ic_launcher.xml'), adaptiveIcon);
writeFileSync(join(adaptiveDir, 'ic_launcher_round.xml'), adaptiveIcon);

const manifestPath = join(androidRoot, 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
manifest = manifest
  .replace(/android:icon="@[^"]+"/, 'android:icon="@mipmap/ic_launcher"')
  .replace(/android:roundIcon="@[^"]+"/, 'android:roundIcon="@mipmap/ic_launcher_round"');
writeFileSync(manifestPath, manifest);

console.log('Applied uploaded Sikka PNG as Android launcher and splash logo assets.');
