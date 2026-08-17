import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCss } from './fixtures/load-css.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function firstRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  return match ? match[1] : '';
}

test('closed schedule dialog stays hidden after native close()', async () => {
  const css = await loadCss('public/style.css');
  const base = firstRuleBody(css, '.schedule-dialog');
  const open = firstRuleBody(css, '.schedule-dialog[open]');
  const closed = firstRuleBody(css, '.schedule-dialog:not([open])');

  assert.doesNotMatch(
    base,
    /display\s*:\s*flex/,
    'unconditional display:flex overrides UA dialog:not([open]){display:none} and leaves the panel on screen',
  );
  assert.match(open, /display\s*:\s*flex/, 'open schedule dialog still uses flex layout');
  assert.match(closed, /display\s*:\s*none\s*!important/, 'closed schedule dialog must stay out of composer body flex');

  const anyClosed = firstRuleBody(css, 'dialog:not([open])');
  assert.match(
    anyClosed,
    /display\s*:\s*none\s*!important/,
    'closed dialogs must not become flex items when 新增內容 locks body to a column',
  );
});
