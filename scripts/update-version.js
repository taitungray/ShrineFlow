import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndexHtml } from './build-html.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version) {
  throw new Error('package.json missing version field');
}

console.log(`\n========================================`);
console.log(`  ShrineFlow Version Sync: v${version}`);
console.log(`========================================\n`);

// 1. Update public/style.css entry point with new version
const styleCss = `/**
 * ShrineFlow Design System - Main Stylesheet Entry
 * Modular CSS Architecture (Zero-Build Vanilla CSS)
 */

/* 1. Core Tokens & Base */
@import url('./css/tokens.css?v=${version}');
@import url('./css/base.css?v=${version}');
@import url('./css/layout.css?v=${version}');

/* 2. Global UI Components (Aggregator) */
@import url('./css/components.css?v=${version}');

/* 3. Feature Views & Modules */
@import url('./css/views/editor.css?v=${version}');
@import url('./css/views/workflow.css?v=${version}');
@import url('./css/views/calendar.css?v=${version}');
@import url('./css/views/media-logs.css?v=${version}');
@import url('./css/views/marketing.css?v=${version}');
@import url('./css/views/insights-inbox.css?v=${version}');
@import url('./css/views/team-auth.css?v=${version}');
@import url('./css/views/settings.css?v=${version}');
`;
fs.writeFileSync(path.join(__dirname, '../public/style.css'), styleCss, 'utf8');
console.log(`[OK] public/style.css (@import ?v=${version})`);

// 2. Update public/css/components.css
const componentsCss = `/* ==========================================================================
   ShrineFlow Global UI Components - Aggregator
   ========================================================================== */

@import url('./components/buttons.css?v=${version}');
@import url('./components/forms.css?v=${version}');
@import url('./components/cards.css?v=${version}');
@import url('./components/dialogs.css?v=${version}');
@import url('./components/feedback.css?v=${version}');
@import url('./components/platform-icons.css?v=${version}');
`;
fs.writeFileSync(path.join(__dirname, '../public/css/components.css'), componentsCss, 'utf8');
console.log(`[OK] public/css/components.css (@import ?v=${version})`);

// 3. Assemble and update public/index.html with new version
const buildResult = buildIndexHtml({ version });
console.log(`[OK] public/index.html (assembled from ${buildResult.partsCount} partials ?v=${version})`);

// 4. Update public/app.js imports WITHOUT ?v= on submodule paths.
// ESM treats `./modules/state.js` and `./modules/state.js?v=x` as different modules.
// Cache-bust only the entry (`index.html` → app.js?v=...); keep one shared state singleton.
const appJsPath = path.join(__dirname, '../public/app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');
appJs = appJs.replace(/from\s+['"]\.\/modules\/([a-zA-Z0-9_.-]+)\.js(?:\?v=[^'"]*)?['"]/g, `from './modules/$1.js'`);
fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log(`[OK] public/app.js (submodule imports are unversioned ESM singletons)`);

// 5. Clean intra-module imports inside public/modules/*.js (same singleton rule)
const modulesDir = path.join(__dirname, '../public/modules');
const moduleFiles = fs.readdirSync(modulesDir).filter((f) => f.endsWith('.js'));
let cleanModuleCount = 0;

for (const file of moduleFiles) {
  const filePath = path.join(modulesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  content = content.replace(/from\s+['"]\.\/([a-zA-Z0-9_.-]+)\.js(?:\?v=[^'"]*)?['"]/g, `from './$1.js'`);
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    cleanModuleCount++;
  }
}
console.log(`[OK] public/modules/*.js (${cleanModuleCount} files normalized for ESM singletons)`);
console.log(`\nAll files synchronized to v${version} successfully!\n`);
