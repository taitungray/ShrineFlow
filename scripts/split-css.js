import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cssContent = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const lines = cssContent.split('\n');

if (lines.length < 100) {
  console.log('style.css already modularized. Skipping split.');
  process.exit(0);
}

function getSlice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

// 1. Tokens (1 - 66)
const tokensCss = `/* ==========================================================================
   ShrineFlow Design Tokens & Color Schemes
   ========================================================================== */
` + getSlice(1, 66);

// 2. Base (67 - 77, 164 - 190)
const baseCss = `/* ==========================================================================
   ShrineFlow Base & Reset Styles
   ========================================================================== */
` + getSlice(67, 77) + '\n\n' + getSlice(164, 190);

// 3. Layout (191 - 328, 401 - 403, 2105 - 3001, 5696 - 5873)
const layoutCss = `/* ==========================================================================
   ShrineFlow Shell, Header & Responsive Layout
   ========================================================================== */
` + getSlice(191, 328) + '\n\n' + getSlice(401, 403) + '\n\n' + getSlice(2105, 3001) + '\n\n' + getSlice(5696, 5873);

// 4. Components (404 - 1353, 1482 - 1563, 1572 - 1766)
const componentsCss = `/* ==========================================================================
   ShrineFlow Global UI Components
   ========================================================================== */
` + getSlice(404, 1353) + '\n\n' + getSlice(1482, 1563) + '\n\n' + getSlice(1572, 1766);

// 5. Views: Editor & Preview (1354 - 1481, 1767 - 2104)
const viewEditorCss = `/* ==========================================================================
   View: Post Composer & Multi-Platform Preview
   ========================================================================== */
` + getSlice(1354, 1481) + '\n\n' + getSlice(1767, 2104);

// 6. Views: Workflow & Content Lists (78 - 163, 3312 - 4025)
const viewWorkflowCss = `/* ==========================================================================
   View: Content Workflow, Drafts & Approval Queues
   ========================================================================== */
` + getSlice(78, 163) + '\n\n' + getSlice(3312, 4025);

// 7. Views: Calendar & Scheduling (4026 - 4247)
const viewCalendarCss = `/* ==========================================================================
   View: Content Calendar & Publishing Scheduler
   ========================================================================== */
` + getSlice(4026, 4247);

// 8. Views: Media, Logs & Connections (4248 - 4870)
const viewMediaLogsCss = `/* ==========================================================================
   View: Media Library, Publishing Logs & Platform Diagnostics
   ========================================================================== */
` + getSlice(4248, 4870);

// 9. Views: Templates & Campaigns (4871 - 5209)
const viewMarketingCss = `/* ==========================================================================
   View: Post Templates & Campaign Timelines
   ========================================================================== */
` + getSlice(4871, 5209);

// 10. Views: Insights & Inbox (5210 - 5695)
const viewInsightsInboxCss = `/* ==========================================================================
   View: Analytics Insights & Cross-Platform Inbox
   ========================================================================== */
` + getSlice(5210, 5695);

// 11. Views: Team & Auth (3002 - 3311)
const viewTeamAuthCss = `/* ==========================================================================
   View: Team Management, Roles & Auth Gate
   ========================================================================== */
` + getSlice(3002, 3311);

// 12. Views: Settings (1564 - 1571)
const viewSettingsCss = `/* ==========================================================================
   View: Settings & Configuration Subsections
   ========================================================================== */
` + getSlice(1564, 1571);

// Write files
const files = {
  'public/css/tokens.css': tokensCss,
  'public/css/base.css': baseCss,
  'public/css/layout.css': layoutCss,
  'public/css/components.css': componentsCss,
  'public/css/views/editor.css': viewEditorCss,
  'public/css/views/workflow.css': viewWorkflowCss,
  'public/css/views/calendar.css': viewCalendarCss,
  'public/css/views/media-logs.css': viewMediaLogsCss,
  'public/css/views/marketing.css': viewMarketingCss,
  'public/css/views/insights-inbox.css': viewInsightsInboxCss,
  'public/css/views/team-auth.css': viewTeamAuthCss,
  'public/css/views/settings.css': viewSettingsCss
};

Object.entries(files).forEach(([relPath, content]) => {
  const fullPath = path.join(__dirname, '..', relPath);
  fs.writeFileSync(fullPath, content.trim() + '\n', 'utf8');
  console.log(`Saved: ${relPath} (${content.split('\n').length} lines)`);
});

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const version = pkg.version || '0.6.28';

// Write Main style.css Entry Point
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
console.log('Saved: public/style.css (Modular Entry Point)');
