import fs from 'node:fs/promises';
import path from 'node:path';

import { directories, makeId, mutateJson, readJson } from './store.js';

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function getInsightsSnapshotPath(value = new Date()) {
  const month = normalizeDate(value).toISOString().slice(0, 7);
  return path.join(directories.insights, `${month}.json`);
}

export async function appendInsightsSnapshot(snapshot = {}) {
  if (!snapshot.clientId || !snapshot.accountId || !snapshot.platformId) return null;
  const record = {
    id: makeId(),
    savedAt: new Date().toISOString(),
    ...snapshot,
  };
  const filePath = getInsightsSnapshotPath(record.fetchedAt || record.savedAt);
  await fs.mkdir(directories.insights, { recursive: true });
  await mutateJson(filePath, (records) => {
    records.push(record);
    return record;
  }, []);
  return record;
}

export async function findLatestInsightsSnapshot({ clientId, accountId, platformId } = {}) {
  if (!clientId || !accountId || !platformId) return null;
  const names = await fs.readdir(directories.insights).catch(() => []);
  const archiveNames = names
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  for (const name of archiveNames) {
    const records = await readJson(path.join(directories.insights, name), []);
    const match = [...records].reverse().find((record) => (
      record.clientId === clientId
      && record.accountId === accountId
      && record.platformId === platformId
    ));
    if (match) return match;
  }
  return null;
}
