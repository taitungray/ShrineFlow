import fs from 'node:fs/promises';
import path from 'node:path';

import { directories, makeId, mutateJson, readJson } from './store.js';
import {
  HISTORY_RETENTION_POLICIES,
  pruneHistoryArchives,
  trimHistoryRecords,
} from './history-retention.js';

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function getPublishAttemptArchivePath(value = new Date()) {
  const date = normalizeDate(value);
  const month = date.toISOString().slice(0, 7);
  return path.join(directories.publishAttempts, `${month}.json`);
}

export async function findPublishAttemptByIdempotencyKey({
  postId,
  targetId,
  idempotencyKey,
} = {}) {
  if (!idempotencyKey) return null;
  const names = await fs.readdir(directories.publishAttempts).catch(() => []);
  const archiveNames = names
    .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  for (const name of archiveNames) {
    const events = await readJson(path.join(directories.publishAttempts, name), []);
    const match = [...events].reverse().find((event) => (
      event.postId === postId
      && event.targetId === targetId
      && event.idempotencyKey === idempotencyKey
    ));
    if (match) return { ...match, id: match.attemptId };
  }
  return null;
}

export async function recordPublishAttemptEvent({
  postId,
  targetId,
  platformId,
  attempt,
  eventType,
  occurredAt = new Date(),
} = {}) {
  if (!attempt?.id || !eventType) return null;

  const occurredAtIso = normalizeDate(occurredAt).toISOString();
  const event = {
    id: makeId(),
    eventType,
    occurredAt: occurredAtIso,
    postId: postId || null,
    targetId: targetId || null,
    platformId: platformId || null,
    attemptId: attempt.id,
    source: attempt.source || 'unknown',
    idempotencyKey: attempt.idempotencyKey || '',
    status: attempt.status || 'unknown',
    startedAt: attempt.startedAt || null,
    finishedAt: attempt.finishedAt || null,
    externalId: attempt.externalId || null,
    error: attempt.error || null,
  };

  const archivePath = getPublishAttemptArchivePath(occurredAtIso);
  await fs.mkdir(directories.publishAttempts, { recursive: true });
  await mutateJson(archivePath, (events) => {
    events.push(event);
    trimHistoryRecords(events, HISTORY_RETENTION_POLICIES.publishAttempts.maxRecordsPerArchive);
    return event;
  }, []);
  await pruneHistoryArchives(directories.publishAttempts, HISTORY_RETENTION_POLICIES.publishAttempts);
  return event;
}
