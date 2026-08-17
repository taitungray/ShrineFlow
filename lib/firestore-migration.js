import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  decryptClientSecrets,
  encryptClientSecrets,
} from './secret-storage.js';
import { directories, readJson } from './store.js';

export const MIGRATION_COLLECTIONS = Object.freeze([
  'gods',
  'posts',
  'schedule',
  'clients',
  'templates',
  'campaigns',
  'savedReplies',
  'inboxMetadata',
  'notifications',
  'errorLog',
  'mediaAssets',
  'users',
  'memberships',
  'invitations',
  'auditEvents',
  'postVersions',
  'publishAttempts',
  'insightsSnapshots',
]);

export const SINGLETON_COLLECTIONS = Object.freeze({
  inboxMetadata: { arrayKeys: [], objectKeys: ['items', 'cursors', 'syncHints'] },
  notifications: { arrayKeys: ['items'], objectKeys: [] },
  errorLog: { arrayKeys: ['items'], objectKeys: [] },
});

export const HISTORY_MONTH_DIRS = Object.freeze({
  postVersions: directories.postVersions,
  publishAttempts: directories.publishAttempts,
  insightsSnapshots: directories.insights,
});

const MONTH_FILE_PATTERN = /^\d{4}-\d{2}\.json$/;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function contentForHash(record) {
  if (!record || typeof record !== 'object') return record;
  const clone = Array.isArray(record) ? record.slice() : { ...record };
  if (!Array.isArray(clone)) {
    delete clone.updatedAt;
    delete clone.createdAt;
    delete clone.lastLoginAt;
  }
  return clone;
}

export function contentHash(record) {
  return crypto.createHash('sha256').update(stableStringify(contentForHash(record))).digest('hex');
}

export function fingerprintCollection(value) {
  if (Array.isArray(value)) {
    const rows = value
      .map((record) => `${recordKey(record)}:${contentHash(record)}`)
      .sort();
    return crypto.createHash('sha256').update(rows.join('|')).digest('hex');
  }
  return contentHash(value);
}

export function recordKey(record, { idFields = ['id'] } = {}) {
  if (!record || typeof record !== 'object') return '';
  for (const field of idFields) {
    const value = String(record[field] || '').trim();
    if (value) return value;
  }
  if (record.attemptId) return String(record.attemptId);
  if (record.versionId) return String(record.versionId);
  return contentHash(record).slice(0, 32);
}

function parseTimestamp(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function recordTimestamp(record = {}) {
  return parseTimestamp(record.updatedAt)
    ?? parseTimestamp(record.createdAt)
    ?? parseTimestamp(record.occurredAt)
    ?? parseTimestamp(record.savedAt)
    ?? parseTimestamp(record.fetchedAt);
}

export function decideRecordMerge({ local, remote } = {}) {
  if (!local && remote) {
    return { action: 'keep', id: recordKey(remote), record: remote, reason: 'cloud_only' };
  }
  if (local && !remote) {
    return { action: 'create', id: recordKey(local), record: local, reason: 'local_only' };
  }
  const id = recordKey(local) || recordKey(remote);
  if (contentHash(local) === contentHash(remote)) {
    return { action: 'keep', id, record: remote, reason: 'identical' };
  }
  const localTs = recordTimestamp(local);
  const remoteTs = recordTimestamp(remote);
  if (localTs == null || remoteTs == null || localTs === remoteTs) {
    return {
      action: 'conflict',
      id,
      local,
      remote,
      reason: localTs == null || remoteTs == null ? 'missing_timestamp' : 'equal_timestamp',
    };
  }
  if (localTs > remoteTs) {
    return { action: 'update', id, record: local, reason: 'local_newer', previous: remote };
  }
  return { action: 'keep', id, record: remote, reason: 'remote_newer' };
}

function summarize(decisions) {
  const summary = { create: 0, update: 0, keep: 0, conflict: 0 };
  for (const decision of decisions) {
    if (summary[decision.action] !== undefined) summary[decision.action] += 1;
  }
  return summary;
}

export function mergeCollections({ name, local = [], remote = [], idFields = ['id'] } = {}) {
  const localList = Array.isArray(local) ? local : [];
  const remoteList = Array.isArray(remote) ? remote : [];
  const remoteById = new Map(remoteList.map((record) => [recordKey(record, { idFields }), record]));
  const seen = new Set();
  const decisions = [];

  for (const record of localList) {
    const id = recordKey(record, { idFields });
    seen.add(id);
    decisions.push(decideRecordMerge({ local: record, remote: remoteById.get(id) || null }));
  }
  for (const record of remoteList) {
    const id = recordKey(record, { idFields });
    if (seen.has(id)) continue;
    decisions.push(decideRecordMerge({ local: null, remote: record }));
  }

  return {
    name,
    kind: 'collection',
    decisions,
    summary: summarize(decisions),
    remoteFingerprint: fingerprintCollection(remoteList),
    remote: remoteList,
  };
}

function mergeArrayById(localItems = [], remoteItems = []) {
  const plan = mergeCollections({
    name: 'items',
    local: Array.isArray(localItems) ? localItems : [],
    remote: Array.isArray(remoteItems) ? remoteItems : [],
  });
  const byId = new Map();
  for (const decision of plan.decisions) {
    if (decision.action === 'conflict') continue;
    byId.set(decision.id, decision.record);
  }
  return {
    items: [...byId.values()],
    conflicts: plan.decisions.filter((item) => item.action === 'conflict'),
  };
}

function mergeObjectMaps(localMap = {}, remoteMap = {}) {
  return { ...remoteMap, ...localMap };
}

export function mergeSingletons({
  name,
  local = {},
  remote = {},
  arrayKeys = SINGLETON_COLLECTIONS[name]?.arrayKeys || [],
  objectKeys = SINGLETON_COLLECTIONS[name]?.objectKeys || [],
} = {}) {
  const conflicts = [];
  const record = {
    ...remote,
    ...local,
    version: Math.max(Number(local.version) || 1, Number(remote.version) || 1),
  };

  for (const key of arrayKeys) {
    const merged = mergeArrayById(local[key], remote[key]);
    record[key] = merged.items;
    conflicts.push(...merged.conflicts.map((item) => ({ ...item, path: `${name}.${key}` })));
  }
  for (const key of objectKeys) {
    record[key] = mergeObjectMaps(local[key], remote[key]);
  }

  if (conflicts.length) {
    return {
      name,
      kind: 'singleton',
      action: 'conflict',
      conflicts,
      summary: { create: 0, update: 0, keep: 0, conflict: conflicts.length },
      remoteFingerprint: fingerprintCollection(remote),
    };
  }

  const identical = contentHash(record) === contentHash(remote);
  return {
    name,
    kind: 'singleton',
    action: identical ? 'keep' : 'update',
    record,
    summary: identical
      ? { create: 0, update: 0, keep: 1, conflict: 0 }
      : { create: 0, update: 1, keep: 0, conflict: 0 },
    remoteFingerprint: fingerprintCollection(remote),
  };
}

export async function loadLocalHistoryCollection(name) {
  const directory = HISTORY_MONTH_DIRS[name];
  if (!directory) return [];
  const names = await fs.readdir(directory).catch(() => []);
  const records = [];
  for (const fileName of names.filter((item) => MONTH_FILE_PATTERN.test(item)).sort()) {
    const entries = await readJson(path.join(directory, fileName), []);
    if (Array.isArray(entries)) records.push(...entries);
  }
  return records;
}

export function rewriteMediaPathsInRecord(record, mapping = new Map()) {
  if (!record || typeof record !== 'object') return { record, missing: [], changed: false };
  const missing = [];
  let changed = false;

  const rewrite = (value) => {
    const current = String(value || '');
    if (!current) return current;
    if (!current.startsWith('/uploads/')) return current;
    if (mapping.has(current)) {
      changed = true;
      return mapping.get(current);
    }
    missing.push(current);
    return current;
  };

  const next = { ...record };
  if (next.imagePath) next.imagePath = rewrite(next.imagePath);
  if (Array.isArray(next.mediaPaths)) next.mediaPaths = next.mediaPaths.map(rewrite);
  if (Array.isArray(next.targets)) {
    next.targets = next.targets.map((target) => ({
      ...target,
      mediaPaths: Array.isArray(target.mediaPaths) ? target.mediaPaths.map(rewrite) : target.mediaPaths,
    }));
  }
  if (next.snapshot?.mediaPaths || next.snapshot?.imagePath) {
    next.snapshot = {
      ...next.snapshot,
      imagePath: next.snapshot.imagePath ? rewrite(next.snapshot.imagePath) : next.snapshot.imagePath,
      mediaPaths: Array.isArray(next.snapshot.mediaPaths)
        ? next.snapshot.mediaPaths.map(rewrite)
        : next.snapshot.mediaPaths,
    };
  }
  return { record: next, missing: [...new Set(missing)], changed };
}

export function reencryptClientForTarget(client, { sourceKey, targetKey } = {}) {
  if (!client || typeof client !== 'object') return client;
  let decrypted;
  try {
    decrypted = decryptClientSecrets(client, sourceKey);
  } catch (error) {
    const wrapped = new Error(`品牌 ${client.id || '(unknown)'} 憑證解密失敗：${error.message}`);
    wrapped.code = 'CLIENT_SECRET_DECRYPT_FAILED';
    wrapped.clientId = client.id;
    throw wrapped;
  }
  return encryptClientSecrets(decrypted, targetKey);
}

export function prepareClientsForMigration(clients = [], { sourceKey, targetKey } = {}) {
  const prepared = [];
  const errors = [];
  for (const client of clients) {
    try {
      prepared.push(reencryptClientForTarget(client, { sourceKey, targetKey }));
    } catch (error) {
      errors.push({
        action: 'conflict',
        id: client?.id || '',
        reason: 'secret_reencrypt_failed',
        message: error.message,
      });
    }
  }
  return { clients: prepared, errors };
}

export function buildMergedCollectionValue(plan) {
  if (plan.kind === 'singleton') return plan.record;
  const byId = new Map();
  for (const decision of plan.decisions || []) {
    if (decision.action === 'conflict') continue;
    byId.set(decision.id, decision.record);
  }
  return [...byId.values()];
}

export function countPlanConflicts(planDocument = {}) {
  let total = 0;
  for (const collection of planDocument.collections || []) {
    total += collection.summary?.conflict || 0;
  }
  total += (planDocument.mediaConflicts || []).length;
  total += (planDocument.secretConflicts || []).length;
  return total;
}

export async function applyMergePlan({
  plan,
  loadRemote,
  replaceRemote,
} = {}) {
  if (!plan || !Array.isArray(plan.collections)) {
    throw new Error('Merge plan is required.');
  }
  const conflicts = countPlanConflicts(plan);
  if (conflicts > 0) {
    const error = new Error(`Merge plan still has ${conflicts} blocking conflict(s).`);
    error.code = 'MERGE_CONFLICTS_REMAIN';
    throw error;
  }

  for (const collection of plan.collections) {
    const currentRemote = await loadRemote(collection.name);
    const expected = plan.remoteFingerprints?.[collection.name] || collection.remoteFingerprint;
    const actual = fingerprintCollection(currentRemote);
    if (expected && expected !== actual) {
      const error = new Error(`Remote fingerprint changed for ${collection.name}; refresh the merge plan.`);
      error.code = 'REMOTE_FINGERPRINT_CHANGED';
      error.collection = collection.name;
      throw error;
    }
    if (collection.kind === 'singleton') {
      if (collection.action === 'keep') continue;
      await replaceRemote(collection.name, collection.record);
      continue;
    }
    const hasWrites = (collection.summary?.create || 0) + (collection.summary?.update || 0) > 0;
    if (!hasWrites) continue;
    await replaceRemote(collection.name, buildMergedCollectionValue(collection));
  }
  return { ok: true };
}

export function summarizePlan(planDocument = {}) {
  const totals = { create: 0, update: 0, keep: 0, conflict: 0 };
  for (const collection of planDocument.collections || []) {
    for (const key of Object.keys(totals)) {
      totals[key] += collection.summary?.[key] || 0;
    }
  }
  return {
    ...totals,
    mediaConflicts: (planDocument.mediaConflicts || []).length,
    secretConflicts: (planDocument.secretConflicts || []).length,
    blockingConflicts: countPlanConflicts(planDocument),
  };
}

export function createEmptyPlanDocument({ source = 'local-json', target = 'firestore' } = {}) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source,
    target,
    collections: [],
    remoteFingerprints: {},
    mediaMapping: {},
    mediaConflicts: [],
    secretConflicts: [],
  };
}
