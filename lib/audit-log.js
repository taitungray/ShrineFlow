import { getRepositories } from './repositories.js';
import { makeId } from './store.js';
import { assertCollectionCapacity } from './storage-policy.js';

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token|api.?key)/i;

export const AUDIT_POLICY = Object.freeze({
  retentionDays: 365,
  maxRecords: 10000,
});

export function auditPolicyFromEnv(env = process.env) {
  const retentionDays = Number(env.SHRINEFLOW_AUDIT_RETENTION_DAYS);
  const maxRecords = Number(env.SHRINEFLOW_AUDIT_MAX_RECORDS);
  return {
    retentionDays: Number.isFinite(retentionDays) && retentionDays > 0
      ? Math.min(Math.floor(retentionDays), 3650)
      : AUDIT_POLICY.retentionDays,
    maxRecords: Number.isFinite(maxRecords) && maxRecords > 0
      ? Math.min(Math.floor(maxRecords), AUDIT_POLICY.maxRecords)
      : AUDIT_POLICY.maxRecords,
  };
}

export async function pruneAuditEvents({
  repositories = getRepositories(),
  now = () => Date.now(),
  retentionDays = AUDIT_POLICY.retentionDays,
  maxRecords = AUDIT_POLICY.maxRecords,
} = {}) {
  const repository = repositories?.auditEvents;
  if (!repository || (typeof repository.replace !== 'function' && typeof repository.deleteById !== 'function')) {
    return { removed: 0, remaining: null };
  }
  const events = await repository.list();
  const cutoff = now() - Math.max(1, Number(retentionDays) || AUDIT_POLICY.retentionDays) * 24 * 60 * 60 * 1000;
  const kept = events
    .filter((event) => {
      const timestamp = Date.parse(event?.createdAt || '');
      return !Number.isFinite(timestamp) || timestamp >= cutoff;
    })
    .sort((left, right) => Date.parse(right?.createdAt || '') - Date.parse(left?.createdAt || ''))
    .slice(0, Math.max(1, Number(maxRecords) || AUDIT_POLICY.maxRecords));
  const removed = Math.max(0, events.length - kept.length);
  if (!removed) return { removed: 0, remaining: kept.length };
  if (typeof repository.replace === 'function') {
    await repository.replace(kept);
  } else {
    const keepIds = new Set(kept.map((event) => event.id));
    for (const event of events) {
      if (!keepIds.has(event.id)) await repository.deleteById(event.id);
    }
  }
  return { removed, remaining: kept.length };
}

export function sanitizeAuditMetadata(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeAuditMetadata(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 500);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
    .slice(0, 40)
    .map(([key, item]) => [key, sanitizeAuditMetadata(item, depth + 1)]));
}

export async function appendAuditEvent({
  actor = null,
  clientId = '',
  action,
  resourceType = '',
  resourceId = '',
  requestId = '',
  metadata = {},
  ip = '',
  userAgent = '',
  createdAt = new Date().toISOString(),
} = {}, repositories = getRepositories()) {
  if (!action) throw new Error('Audit action is required.');
  const policy = auditPolicyFromEnv();
  await pruneAuditEvents({ repositories, retentionDays: policy.retentionDays, maxRecords: policy.maxRecords });
  const events = await repositories.auditEvents.list();
  assertCollectionCapacity('auditEvents', events.length, 1);
  const event = {
    id: makeId(),
    clientId: String(clientId || '').trim() || null,
    actorId: actor?.uid || actor?.id || 'system:unknown',
    actorEmail: String(actor?.email || '').trim().toLowerCase(),
    actorType: actor?.type === 'system' ? 'system' : 'user',
    action: String(action),
    resourceType: String(resourceType || ''),
    resourceId: String(resourceId || ''),
    requestId: String(requestId || ''),
    metadata: sanitizeAuditMetadata(metadata),
    ip: String(ip || '').slice(0, 120),
    userAgent: String(userAgent || '').slice(0, 300),
    createdAt,
  };
  await repositories.auditEvents.create(event);
  return event;
}
