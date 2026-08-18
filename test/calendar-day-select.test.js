import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { agendaItemsForView } from '../public/modules/calendar-agenda.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function atLocal(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

const items = [
  { targetId: 'a', scheduledAt: atLocal(2026, 8, 18) },
  { targetId: 'b', scheduledAt: atLocal(2026, 8, 19) },
  { targetId: 'c', scheduledAt: atLocal(2026, 8, 1) },
];
const visibleDateKeys = new Set(['2026-08-18', '2026-08-19']);

test('month agenda stays in-range until a day is selected', () => {
  const visible = agendaItemsForView(items, {
    view: 'month',
    selectedDate: '',
    visibleDateKeys,
  });
  assert.deepEqual(visible.map((item) => item.targetId), ['a', 'b']);
});

test('month agenda narrows to the selected day', () => {
  const visible = agendaItemsForView(items, {
    view: 'month',
    selectedDate: '2026-08-18',
    visibleDateKeys,
  });
  assert.deepEqual(visible.map((item) => item.targetId), ['a']);
});

test('list view ignores the selected day filter', () => {
  const visible = agendaItemsForView(items, {
    view: 'list',
    selectedDate: '2026-08-18',
    visibleDateKeys,
  });
  assert.deepEqual(visible.map((item) => item.targetId), ['a', 'b', 'c']);
});

test('calendar click reveals the day agenda then scrolls to the card', async () => {
  const js = await fs.readFile(path.join(root, 'public', 'modules', 'schedule.js'), 'utf8');
  assert.match(js, /dataset\.selectedDate/, 'panel records the selected calendar day');
  assert.match(js, /scrollIntoView/, 'clicked month chip still scrolls to its action card');
  assert.match(js, /selectedCalendarDate\s*=/, 'click stores the day before re-render');
});
