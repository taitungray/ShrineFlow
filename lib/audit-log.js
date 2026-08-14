import { getRepositories } from './repositories.js';
import { makeId } from './store.js';
import { assertCollectionCapacity } from './storage-policy.js';

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token|api.?key)/i;

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
