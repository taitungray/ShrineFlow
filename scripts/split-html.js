import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const indexPath = path.join(root, 'public', 'index.html');
const viewsDir = path.join(root, 'public', 'views');

if (!fs.existsSync(viewsDir)) {
  fs.mkdirSync(viewsDir, { recursive: true });
}

const html = fs.readFileSync(indexPath, 'utf8');
const lines = html.split(/\r?\n/);

function getSlice(startLine, endLine) {
  return lines.slice(startLine - 1, endLine).join('\n');
}

// Map of partials and their exact line boundaries in the current index.html
const PARTIALS = [
  { name: '_head.html', start: 1, end: 96 },
  { name: '_header-sidebar.html', start: 97, end: 165 },
  { name: 'overview.html', start: 166, end: 196 },
  { name: 'composer.html', start: 197, end: 454 },
  { name: 'settings.html', start: 455, end: 594 },
  { name: 'drafts.html', start: 595, end: 694 },
  { name: 'reviews.html', start: 695, end: 702 },
  { name: 'schedule.html', start: 703, end: 759 },
  { name: 'media.html', start: 760, end: 782 },
  { name: 'templates.html', start: 783, end: 795 },
  { name: 'campaigns.html', start: 796, end: 808 },
  { name: 'publishing.html', start: 809, end: 835 },
  { name: 'inbox.html', start: 836, end: 870 },
  { name: 'platforms.html', start: 871, end: 1139 },
  { name: 'team.html', start: 1140, end: 1208 },
  { name: 'errors.html', start: 1209, end: 1241 },
  { name: 'help.html', start: 1242, end: 1269 },
  { name: 'dialogs.html', start: 1270, end: 1506 },
  { name: '_footer.html', start: 1507, end: lines.length },
];

console.log('Splitting public/index.html into public/views/ partials...');

for (const part of PARTIALS) {
  const content = getSlice(part.start, part.end).trimEnd() + '\n';
  const filePath = path.join(viewsDir, part.name);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  [OK] public/views/${part.name} (${part.end - part.start + 1} lines)`);
}

console.log('\nAll partials created successfully in public/views/!');
