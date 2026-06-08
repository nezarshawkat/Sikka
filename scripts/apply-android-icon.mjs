import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const iconSource = join(repoRoot, 'sikka-app-icon.b64');
const resRoot = join(repoRoot, '..', 'artifacts', 'sikka', 'android', 'app', 'src', 'main', 'res');
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

console.log('Applied Sikka Android launcher icon.');
