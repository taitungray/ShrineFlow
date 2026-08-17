import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const version = pkg.version || '0.6.28';

// 1. Update public/style.css entry point with new version
const styleCss = `/**
 * ShrineFlow Design System - Main Stylesheet Entry
 * Modular CSS Architecture (Zero-Build Vanilla CSS)
 */

/* 1. Core Tokens & Base */
@import url('./css/tokens.css?v=${version}');
@import url('./css/base.css?v=${version}');
@import url('./css/layout.css?v=${version}');

/* 2. Global UI Components */
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
console.log(`Updated: public/style.css (@import ?v=${version})`);

// 2. Update public/index.html with new version
const htmlPath = path.join(__dirname, '../public/index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/href="\/style\.css(\?v=[^"]+)?"/, `href="/style.css?v=${version}"`);
html = html.replace(/src="\/app\.js(\?v=[^"]+)?"/, `src="/app.js?v=${version}"`);
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`Updated: public/index.html (?v=${version})`);
