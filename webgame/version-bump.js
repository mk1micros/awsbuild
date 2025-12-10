#!/usr/bin/env node
/**
 * Simple version bump script.
 * Usage: node version-bump.js [patch|minor|major]
 * Updates config.js version and README Current Version line.
 */
import fs from 'fs';
import path from 'path';

// Determine project root (assume script run from webgame/ directory or repository root)
const cwd = process.cwd();
// If config.js exists in current dir use it, else try webgame/config.js
const directConfig = path.join(cwd, 'config.js');
const nestedConfig = path.join(cwd, 'webgame', 'config.js');
let configPath;
let readmePath;
if (fs.existsSync(directConfig)) {
  configPath = directConfig;
  readmePath = path.join(cwd, 'README.md');
} else if (fs.existsSync(nestedConfig)) {
  configPath = nestedConfig;
  readmePath = path.join(cwd, 'webgame', 'README.md');
} else {
  console.error('Could not locate config.js. Run from project root or webgame/ folder.');
  process.exit(1);
}

const bumpType = process.argv[2] || 'patch';

function incVersion(v, type) {
  const [maj, min, pat] = v.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`; // patch
}

let configSrc = fs.readFileSync(configPath, 'utf8');
const match = configSrc.match(/version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/);
if (!match) {
  console.error('Version not found in config.js');
  process.exit(1);
}
const oldVersion = match[1];
const newVersion = incVersion(oldVersion, bumpType);
configSrc = configSrc.replace(`version: '${oldVersion}'`, `version: '${newVersion}'`);
fs.writeFileSync(configPath, configSrc, 'utf8');

if (fs.existsSync(readmePath)) {
  let readmeSrc = fs.readFileSync(readmePath, 'utf8');
  readmeSrc = readmeSrc.replace(/Current Version:\s*[0-9]+\.[0-9]+\.[0-9]+/, `Current Version: ${newVersion}`);
  fs.writeFileSync(readmePath, readmeSrc, 'utf8');
} else {
  console.warn('README.md not found – skipped updating version line.');
}

console.log(`Bumped version ${oldVersion} -> ${newVersion}`);
console.log(`Updated: ${path.relative(cwd, configPath)}${fs.existsSync(readmePath) ? ', ' + path.relative(cwd, readmePath) : ''}`);
console.log('Next: git add && git commit -m "chore: bump version"');
