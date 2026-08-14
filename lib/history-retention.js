import fs from 'node:fs/promises';
import path from 'node:path';

export const HISTORY_RETENTION_POLICY = Object.freeze({
  maxMonths: 24,
  maxAgeDays: 730,
});

export const HISTORY_RETENTION_POLICIES = Object.freeze({
  publishAttempts: Object.freeze({
    ...HISTORY_RETENTION_POLICY,
    maxRecordsPerArchive: 10000,
  }),
  insights: Object.freeze({
    ...HISTORY_RETENTION_POLICY,
    maxRecordsPerArchive: 5000,
  }),
});

function safePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function archiveDate(name) {
  return Date.parse(`${name.slice(0, 7)}-01T00:00:00.000Z`);
}

export function trimHistoryRecords(records = [], maxRecords = 1) {
  if (!Array.isArray(records)) return [];
  const safeMaxRecords = safePositiveInteger(maxRecords, 1);
  if (records.length <= safeMaxRecords) return records;
  records.splice(0, records.length - safeMaxRecords);
  return records;
}

export async function pruneHistoryArchives(
  directory,
  { maxMonths = HISTORY_RETENTION_POLICY.maxMonths, maxAgeDays = HISTORY_RETENTION_POLICY.maxAgeDays, now = Date.now() } = {},
) {
  const safeMaxMonths = safePositiveInteger(maxMonths, HISTORY_RETENTION_POLICY.maxMonths);
  const safeMaxAgeDays = safePositiveInteger(maxAgeDays, HISTORY_RETENTION_POLICY.maxAgeDays);
  const cutoff = Number(now) - (safeMaxAgeDays * 24 * 60 * 60 * 1000);
  const names = await fs.readdir(directory).catch(() => []);
  const archiveNames = names
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  const deleted = [];

  for (const [index, name] of archiveNames.entries()) {
    const archivePath = path.resolve(directory, name);
    if (path.dirname(archivePath) !== path.resolve(directory)) continue;
    const isTooOld = Number.isFinite(archiveDate(name)) && archiveDate(name) < cutoff;
    if (index < safeMaxMonths && !isTooOld) continue;
    await fs.rm(archivePath, { force: true });
    deleted.push(name);
  }
  return deleted;
}
