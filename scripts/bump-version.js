import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const parts = (pkg.version || '0.1.0').split('.').map(Number);
parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
pkg.version = parts.join('.');
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`Bumped version to ${pkg.version}`);

execSync('node scripts/update-version.js', { stdio: 'inherit' });
