import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

export const HTML_PARTIAL_ORDER = [
  '_head.html',
  '_header-sidebar.html',
  'overview.html',
  'composer.html',
  'settings.html',
  'drafts.html',
  'reviews.html',
  'schedule.html',
  'media.html',
  'templates.html',
  'campaigns.html',
  'publishing.html',
  'inbox.html',
  'platforms.html',
  'team.html',
  'errors.html',
  'help.html',
  'dialogs.html',
  '_footer.html',
];

export function buildIndexHtml({ version = null } = {}) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const currentVersion = version || pkg.version;
  const viewsDir = path.join(root, 'public', 'views');
  const outputPath = path.join(root, 'public', 'index.html');

  if (!fs.existsSync(viewsDir)) {
    throw new Error(`Views directory missing: ${viewsDir}`);
  }

  const parts = [];
  for (const file of HTML_PARTIAL_ORDER) {
    const filePath = path.join(viewsDir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required HTML partial: ${file}`);
    }
    parts.push(fs.readFileSync(filePath, 'utf8').trimEnd());
  }

  let fullHtml = parts.join('\n\n') + '\n';

  // Synchronize version tags and cache busters in assembled index.html
  fullHtml = fullHtml.replace(/style\.css\?v=[^"']+/g, `style.css?v=${currentVersion}`);
  fullHtml = fullHtml.replace(/app\.js\?v=[^"']+/g, `app.js?v=${currentVersion}`);
  fullHtml = fullHtml.replace(/<em class="version-tag" id="appVersion">[^<]*<\/em>/g, `<em class="version-tag" id="appVersion">v${currentVersion}</em>`);
  fullHtml = fullHtml.replace(/<span class="version-tag" id="authAppVersion">[^<]*<\/span>/g, `<span class="version-tag" id="authAppVersion">v${currentVersion}</span>`);

  fs.writeFileSync(outputPath, fullHtml, 'utf8');
  return { version: currentVersion, path: outputPath, partsCount: parts.length };
}

// Allow direct execution: node scripts/build-html.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildIndexHtml();
  console.log(`[OK] Assembled public/index.html from ${result.partsCount} partials (v${result.version})`);
}
