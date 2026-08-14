import { jsonFiles, mutateJson, readJson } from './store.js';

export const INBOX_METADATA_POLICY = Object.freeze({
  version: 1,
  maxEphemeralItems: 2000,
  maxTagsPerItem: 8,
  maxTagLength: 40,
  maxNoteLength: 1000,
  maxCursorLength: 2000,
  maxSyncHints: 200,
  maxSyncEventsPerHint: 10000,
  maxSyncEventTypeLength: 80,
});

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export function inboxItemKey({ clientId, accountId, platformId, itemId } = {}) {
  return JSON.stringify([clientId, accountId, platformId, itemId].map((value) => normalizeText(value, 200)));
}

function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map((tag) => normalizeText(tag, INBOX_METADATA_POLICY.maxTagLength))
    .filter(Boolean))]
    .slice(0, INBOX_METADATA_POLICY.maxTagsPerItem);
}

function normalizeMetadata(raw = {}) {
  return {
    unread: raw.unread === undefined || raw.unread === null
      ? null
      : (raw.unread === true || raw.unread === 'true'),
    tags: normalizeTags(raw.tags),
    note: normalizeText(raw.note, INBOX_METADATA_POLICY.maxNoteLength),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function isProtected(record) {
  return Boolean(record.note || record.tags?.length);
}

function pruneEphemeralItems(items) {
  const entries = Object.entries(items || {});
  if (entries.length <= INBOX_METADATA_POLICY.maxEphemeralItems) return items;
  const ephemeral = entries
    .filter(([, record]) => !isProtected(record))
    .sort(([, left], [, right]) => new Date(left.updatedAt || 0) - new Date(right.updatedAt || 0));
  const removableCount = Math.min(
    ephemeral.length,
    entries.length - INBOX_METADATA_POLICY.maxEphemeralItems,
  );
  for (const [key] of ephemeral.slice(0, removableCount)) delete items[key];
  return items;
}

function pruneSyncHints(syncHints) {
  const entries = Object.entries(syncHints || {})
    .sort(([, left], [, right]) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  for (const [key] of entries.slice(INBOX_METADATA_POLICY.maxSyncHints)) delete syncHints[key];
  return syncHints;
}

async function readMetadata() {
  const metadata = await readJson(jsonFiles.inboxMetadata, { version: 1, items: {}, cursors: {} });
  return {
    version: INBOX_METADATA_POLICY.version,
    items: metadata?.items && typeof metadata.items === 'object' ? metadata.items : {},
    cursors: metadata?.cursors && typeof metadata.cursors === 'object' ? metadata.cursors : {},
    syncHints: metadata?.syncHints && typeof metadata.syncHints === 'object' ? metadata.syncHints : {},
  };
}

export async function getInboxItemMetadata(identity) {
  const metadata = await readMetadata();
  return metadata.items[inboxItemKey(identity)] || null;
}

export async function updateInboxItemMetadata(identity, changes = {}) {
  const key = inboxItemKey(identity);
  if (!identity.clientId || !identity.accountId || !identity.platformId || !identity.itemId) {
    const error = new Error('缺少收件匣項目識別資料。');
    error.status = 400;
    throw error;
  }
  return mutateJson(jsonFiles.inboxMetadata, (metadata) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      metadata = { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} };
    }
    if (!metadata.items || typeof metadata.items !== 'object') metadata.items = {};
    if (!metadata.cursors || typeof metadata.cursors !== 'object') metadata.cursors = {};
    if (!metadata.syncHints || typeof metadata.syncHints !== 'object') metadata.syncHints = {};
    const previous = metadata.items[key] || {};
    const next = normalizeMetadata({
      ...previous,
      ...changes,
      unread: changes.unread === undefined ? previous.unread : changes.unread,
      tags: changes.tags === undefined ? previous.tags : changes.tags,
      note: changes.note === undefined ? previous.note : changes.note,
    });
    metadata.items[key] = next;
    pruneEphemeralItems(metadata.items);
    return next;
  }, { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} });
}

export async function getInboxCursor(identity) {
  const metadata = await readMetadata();
  return metadata.cursors[inboxItemKey({ ...identity, itemId: '__cursor__' })] || null;
}

export async function saveInboxCursor(identity, cursor) {
  const key = inboxItemKey({ ...identity, itemId: '__cursor__' });
  const value = normalizeText(cursor, INBOX_METADATA_POLICY.maxCursorLength);
  if (!identity.clientId || !identity.accountId || !identity.platformId) return null;
  return mutateJson(jsonFiles.inboxMetadata, (metadata) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      metadata = { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} };
    }
    if (!metadata.items || typeof metadata.items !== 'object') metadata.items = {};
    if (!metadata.cursors || typeof metadata.cursors !== 'object') metadata.cursors = {};
    if (!metadata.syncHints || typeof metadata.syncHints !== 'object') metadata.syncHints = {};
    if (value) metadata.cursors[key] = { value, updatedAt: new Date().toISOString() };
    else delete metadata.cursors[key];
    return metadata.cursors[key] || null;
  }, { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} });
}

export async function getInboxSyncHint(identity) {
  const metadata = await readMetadata();
  return metadata.syncHints[inboxItemKey({ ...identity, itemId: '__sync_hint__' })] || null;
}

export async function markInboxSyncHint(identity, {
  eventType = 'unknown',
  eventCount = 1,
  receivedAt = new Date().toISOString(),
} = {}) {
  if (!identity?.clientId || !identity?.accountId || !identity?.platformId) return null;
  const key = inboxItemKey({ ...identity, itemId: '__sync_hint__' });
  const cursorKey = inboxItemKey({ ...identity, itemId: '__cursor__' });
  const boundedCount = Math.min(
    INBOX_METADATA_POLICY.maxSyncEventsPerHint,
    Math.max(1, Number(eventCount) || 1),
  );
  return mutateJson(jsonFiles.inboxMetadata, (metadata) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      metadata = { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} };
    }
    if (!metadata.items || typeof metadata.items !== 'object') metadata.items = {};
    if (!metadata.cursors || typeof metadata.cursors !== 'object') metadata.cursors = {};
    if (!metadata.syncHints || typeof metadata.syncHints !== 'object') metadata.syncHints = {};
    const previous = metadata.syncHints[key] || {};
    const updatedAt = new Date(receivedAt);
    const timestamp = Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString();
    metadata.syncHints[key] = {
      pending: true,
      source: 'meta_webhook',
      eventType: normalizeText(eventType, INBOX_METADATA_POLICY.maxSyncEventTypeLength) || 'unknown',
      eventCount: Math.min(
        INBOX_METADATA_POLICY.maxSyncEventsPerHint,
        (Number(previous.eventCount) || 0) + boundedCount,
      ),
      updatedAt: timestamp,
    };
    delete metadata.cursors[cursorKey];
    pruneSyncHints(metadata.syncHints);
    return metadata.syncHints[key];
  }, { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} });
}

export async function clearInboxSyncHint(identity, expectedUpdatedAt = '') {
  if (!identity?.clientId || !identity?.accountId || !identity?.platformId) return null;
  const key = inboxItemKey({ ...identity, itemId: '__sync_hint__' });
  return mutateJson(jsonFiles.inboxMetadata, (metadata) => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    if (!metadata.syncHints || typeof metadata.syncHints !== 'object') metadata.syncHints = {};
    if (expectedUpdatedAt && metadata.syncHints[key]?.updatedAt !== expectedUpdatedAt) {
      return metadata.syncHints[key] || null;
    }
    delete metadata.syncHints[key];
    return null;
  }, { version: INBOX_METADATA_POLICY.version, items: {}, cursors: {}, syncHints: {} });
}

export async function applyInboxItemMetadata(items, identity) {
  const metadata = await readMetadata();
  return (Array.isArray(items) ? items : []).map((item) => {
    const record = metadata.items[inboxItemKey({ ...identity, itemId: item.id })];
    return {
      ...item,
      unread: record?.unread === null || record?.unread === undefined ? Boolean(item.unread) : record.unread,
      tags: record?.tags || [],
      note: record?.note || '',
      metadataUpdatedAt: record?.updatedAt || null,
    };
  });
}
