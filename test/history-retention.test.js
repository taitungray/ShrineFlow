import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  pruneHistoryArchives,
  trimHistoryRecords,
} from '../lib/history-retention.js';

test('trimHistoryRecords keeps only the newest bounded records', () => {
  const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(trimHistoryRecords(records, 2), [{ id: 2 }, { id: 3 }]);
});

test('pruneHistoryArchives removes archives beyond count and age limits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-history-'));
  try {
    for (const month of ['2026-08', '2026-07', '2026-06', '2026-05', '2024-01']) {
      await fs.writeFile(path.join(directory, `${month}.json`), '[]', 'utf8');
    }

    const deleted = await pruneHistoryArchives(directory, {
      maxMonths: 3,
      maxAgeDays: 730,
      now: Date.parse('2026-08-14T00:00:00.000Z'),
    });
    const remaining = (await fs.readdir(directory)).sort();

    assert.deepEqual(deleted.sort(), ['2024-01.json', '2026-05.json']);
    assert.deepEqual(remaining, ['2026-06.json', '2026-07.json', '2026-08.json']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
