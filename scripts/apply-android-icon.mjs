import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const iconSource = join(scriptDir, 'sikka-app-icon.b64');
const androidRoot = join(repoRoot, 'artifacts', 'sikka', 'android', 'app', 'src', 'main');
const resRoot = join(androidRoot, 'res');
const checkedInIcon = join(resRoot, 'drawable', 'sikka_icon.png');
const iconPng = existsSync(checkedInIcon)
  ? readFileSync(checkedInIcon)
  : Buffer.from(readFileSync(iconSource, 'utf8').replace(/\s+/g, ''), 'base64');

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
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png', 'sikka_launcher.png']) {
    const target = join(dir, name);
    if (!existsSync(target)) writeFileSync(target, iconPng);
  }
}

const drawableDir = join(resRoot, 'drawable');
mkdirSync(drawableDir, { recursive: true });
for (const name of ['sikka_icon.png', 'sikka_logo.png']) {
  const target = join(drawableDir, name);
  if (!existsSync(target)) writeFileSync(target, iconPng);
}

const adaptiveDir = join(resRoot, 'mipmap-anydpi-v26');
mkdirSync(adaptiveDir, { recursive: true });
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const target = join(adaptiveDir, name);
  if (existsSync(target)) rmSync(target);
}

const manifestPath = join(androidRoot, 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
manifest = manifest
  .replace(/android:icon="@[^"]+"/, 'android:icon="@mipmap/ic_launcher"')
  .replace(/android:roundIcon="@[^"]+"/, 'android:roundIcon="@mipmap/ic_launcher_round"');
writeFileSync(manifestPath, manifest);

console.log('Applied safe Android launcher icon references.');
