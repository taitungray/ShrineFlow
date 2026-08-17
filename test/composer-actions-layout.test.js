import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCss } from './fixtures/load-css.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map((match) => match[1]);
}

test('composer dock keeps save/schedule/publish off the evergreen fieldset', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const dockAt = html.indexOf('class="composer-dock"');
  const actionsAt = html.indexOf('class="action-row composer-actions"');
  const evergreenAt = html.indexOf('class="form-group-card evergreen-card"');
  const saveAt = html.indexOf('id="saveButton"');
  const advancedAt = html.indexOf('class="disclosure compact composer-advanced"');

  assert.ok(dockAt > 0, 'composer dock exists');
  assert.ok(actionsAt > dockAt, 'composer actions live inside the dock');
  assert.ok(saveAt > actionsAt, 'save draft lives in the action row');
  assert.ok(advancedAt > 0 && evergreenAt > advancedAt, 'Evergreen is inside the collapsed advanced disclosure');
  assert.ok(evergreenAt < dockAt, 'Evergreen stays in the editor column, not over the dock');

  const dock = ruleBodies(css, '.composer-dock').join('\n');
  assert.match(dock, /grid-row\s*:\s*2/, 'dock occupies its own grid row so fieldset legends cannot cover it');
});

test('save draft uses a high-contrast filled button instead of a ghost secondary', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const saveTag = html.match(/<button[^>]*id="saveButton"[^>]*>/);

  assert.ok(saveTag, 'save draft button exists');
  assert.match(saveTag[0], /\bbtn-save\b/, 'save draft must use the prominent save style');
  assert.doesNotMatch(saveTag[0], /\bbtn-secondary\b/, 'ghost secondary is too faint on dark composer chrome');

  const save = ruleBodies(css, '.btn-save').join('\n');
  assert.match(save, /background\s*:/, 'save draft needs a filled background');
  assert.match(save, /var\(--accent\)/, 'gold accent fill keeps save distinct from red publish');
  assert.match(save, /font-weight\s*:\s*800/, 'save draft is a primary workflow action');
  assert.doesNotMatch(save, /background\s*:\s*var\(--bg-card\)/, 'card-colored fill disappears on dark panels');
});

test('immediate publish is demoted and requires a summary dialog', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const publishTag = html.match(/<button[^>]*id="publishNowButton"[^>]*>/);

  assert.ok(publishTag, 'publish now button exists');
  assert.match(publishTag[0], /\bcomposer-publish-now\b/, 'immediate publish uses the demoted style');
  assert.doesNotMatch(publishTag[0], /\bprimary-button\b/, 'immediate publish must not share the primary CTA');
  assert.match(html, /id="publishConfirmDialog"/, 'publish confirm dialog lists the target before sending');
});

test('composer groups mother copy on the left and platform targets on the right', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const editorAt = html.indexOf('class="composer-editor-pane"');
  const previewAt = html.indexOf('id="reviewPanel"');
  const motherAt = html.indexOf('class="group-title">母稿<');
  const copyAt = html.indexOf('id="facebookText"');
  const targetsAt = html.indexOf('id="targetAccountChecks"');
  const extrasAt = html.indexOf('class="disclosure compact composer-target-advanced"');
  const formOpen = html.indexOf('id="generateForm"');
  const formClose = html.indexOf('</form>', html.indexOf('class="composer-dock"'));

  assert.ok(editorAt > 0 && previewAt > editorAt, 'editor pane precedes preview pane');
  assert.ok(motherAt > editorAt && motherAt < previewAt, '母稿 group stays in the editor pane');
  assert.ok(copyAt > editorAt && copyAt < previewAt, 'copy editor lives with the mother draft, not under the preview');
  assert.ok(targetsAt > previewAt, 'platform target checks live in the preview pane');
  assert.ok(extrasAt > previewAt, 'per-platform format/schedule stay behind 此平台進階');
  assert.ok(formOpen > 0 && formClose > previewAt, 'generateForm wraps editor, preview, and dock');
});
