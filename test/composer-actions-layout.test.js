import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map((match) => match[1]);
}

function pxValue(body, property) {
  const match = body.match(new RegExp(`${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : 0;
}

test('evergreen card stays below composer actions instead of covering save draft', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');
  const actionsAt = html.indexOf('class="action-row composer-actions"');
  const evergreenAt = html.indexOf('class="form-group-card evergreen-card"');
  const saveAt = html.indexOf('id="saveButton"');

  assert.ok(actionsAt > 0, 'composer actions row exists');
  assert.ok(evergreenAt > actionsAt, 'Evergreen card must come after the save/schedule/publish row');
  assert.ok(saveAt > actionsAt && saveAt < evergreenAt, 'save draft lives in the action row, not inside Evergreen');

  const gap = pxValue(ruleBodies(css, '.composer-actions').join('\n'), 'margin-bottom')
    + pxValue(ruleBodies(css, '.evergreen-card').join('\n'), 'margin-top');
  assert.ok(
    gap >= 24,
    `action row and Evergreen need ≥24px gap so the fieldset legend cannot cover 儲存草稿 (got ${gap}px)`,
  );
});

test('save draft uses a high-contrast filled button instead of a ghost secondary', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');
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
