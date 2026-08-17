import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCss } from './fixtures/load-css.js';

import { formatDate } from '../public/modules/dom.js';
import {
  joinDateTimeLocal,
  joinTimeValue,
  pad2,
  splitDateTimeLocal,
  splitTimeValue,
} from '../public/modules/datetime-24h.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('datetime-local helpers keep 24-hour values without meridiem', () => {
  assert.equal(pad2(0), '00');
  assert.equal(pad2('9'), '09');
  assert.equal(pad2('23'), '23');
  assert.deepEqual(splitDateTimeLocal('2026-08-18T13:05'), {
    date: '2026-08-18',
    hour: '13',
    minute: '05',
  });
  assert.equal(joinDateTimeLocal('2026-08-18', '13', '5'), '2026-08-18T13:05');
  assert.equal(joinDateTimeLocal('', '13', '05'), '');
  assert.deepEqual(splitTimeValue('09:00:00'), { hour: '09', minute: '00' });
  assert.equal(joinTimeValue('9', '0'), '09:00');
});

test('formatDate uses 24-hour clock without 上午/下午/中午', () => {
  const noon = formatDate(new Date(2026, 7, 18, 12, 0));
  const afternoon = formatDate(new Date(2026, 7, 18, 13, 5));
  const midnight = formatDate(new Date(2026, 7, 18, 0, 0));
  assert.equal(noon, '2026年8月18日 12:00');
  assert.equal(afternoon, '2026年8月18日 13:05');
  assert.equal(midnight, '2026年8月18日 00:00');
  assert.doesNotMatch(noon + afternoon + midnight, /上午|下午|中午/);
});

test('composer schedule widgets stay 24-hour and wrap without a native meridiem column', async () => {
  const css = await loadCss('public/style.css');
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(css, /\.datetime-24h\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /input\.datetime-24h-native/);
  assert.match(app, /initDateTime24h\(\)/);
  assert.match(html, /id="targetScheduledAt" type="datetime-local"/);
  assert.match(html, /id="scheduledAt" type="datetime-local"/);
});
