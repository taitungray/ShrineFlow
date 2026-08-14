import fs from 'node:fs/promises';
import path from 'node:path';

import { directories, makeId, mutateJson, readJson } from './store.js';
import { getRepositories } from './repositories.js';
import {
  HISTORY_RETENTION_POLICIES,
  pruneHistoryArchives,
  trimHistoryRecords,
} from './history-retention.js';

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function cloudRepository() {
  try {
    const repositories = getRepositories();
    return repositories.backend === 'firestore' ? repositories.insightsSnapshots : null;
  } catch {
    return null;
  }
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
  const repository = cloudRepository();
  if (repository) {
    await repository.mutate((records) => {
      records.push(record);
      trimHistoryRecords(records, HISTORY_RETENTION_POLICIES.insights.maxRecordsPerArchive);
      return record;
    });
    return record;
  }
  await fs.mkdir(directories.insights, { recursive: true });
  await mutateJson(filePath, (records) => {
    records.push(record);
    trimHistoryRecords(records, HISTORY_RETENTION_POLICIES.insights.maxRecordsPerArchive);
    return record;
  }, []);
  await pruneHistoryArchives(directories.insights, HISTORY_RETENTION_POLICIES.insights);
  return record;
}

export async function findLatestInsightsSnapshot({ clientId, accountId, platformId, scope = 'account', targetId = '' } = {}) {
  if (!clientId || !accountId || !platformId) return null;
  const repository = cloudRepository();
  if (repository) {
    const records = await repository.list();
    return [...records].reverse().find((record) => (
      record.clientId === clientId
      && record.accountId === accountId
      && record.platformId === platformId
      && (record.scope || 'account') === scope
      && (!targetId || record.targetId === targetId)
    )) || null;
  }
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
      && (record.scope || 'account') === scope
      && (!targetId || record.targetId === targetId)
    ));
    if (match) return match;
  }
  return null;
}

export async function listInsightsSnapshots({
  clientId,
  accountId,
  platformId,
  scope = 'account',
  targetId = '',
  since,
  until,
  limit = 30,
} = {}) {
  if (!clientId || !accountId || !platformId) return [];
  const repository = cloudRepository();
  if (repository) {
    const lowerBound = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
    const upperBound = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    return (await repository.list())
      .filter((record) => {
        const fetchedAt = Date.parse(record.fetchedAt || record.savedAt || '');
        return record.clientId === clientId
          && record.accountId === accountId
          && record.platformId === platformId
          && (record.scope || 'account') === scope
          && (!targetId || record.targetId === targetId)
          && (!Number.isFinite(fetchedAt) || (fetchedAt >= lowerBound && fetchedAt <= upperBound));
      })
      .sort((a, b) => Date.parse(b.fetchedAt || b.savedAt) - Date.parse(a.fetchedAt || a.savedAt))
      .slice(0, safeLimit);
  }
  const lowerBound = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  const upperBound = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const names = await fs.readdir(directories.insights).catch(() => []);
  const archiveNames = names
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  const matches = [];
  for (const name of archiveNames) {
    const records = await readJson(path.join(directories.insights, name), []);
    for (const record of records) {
      const fetchedAt = Date.parse(record.fetchedAt || record.savedAt || '');
      if (record.clientId !== clientId
        || record.accountId !== accountId
        || record.platformId !== platformId
        || (record.scope || 'account') !== scope
        || (targetId && record.targetId !== targetId)
        || (Number.isFinite(fetchedAt) && (fetchedAt < lowerBound || fetchedAt > upperBound))) continue;
      matches.push(record);
    }
  }
  return matches
    .sort((a, b) => Date.parse(b.fetchedAt || b.savedAt) - Date.parse(a.fetchedAt || a.savedAt))
    .slice(0, safeLimit);
}
