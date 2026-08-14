import { appendAuditEvent } from './audit-log.js';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_THRESHOLD = 5;

function normalizedType(value) {
  return String(value || 'security.event')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 80);
}
export async function recordSecurityEvent({
  type,
  actor = null,
  clientId = '',
  resourceType = 'security',
  resourceId = '',
  requestId = '',
  metadata = {},
  ip = '',
  userAgent = '',
} = {}, repositories) {
  if (!repositories?.auditEvents) return null;
  return appendAuditEvent({
    actor,
    clientId,
    action: `security.${normalizedType(type).replace(/^security\./, '')}`,
    resourceType,
    resourceId,
    requestId,
    metadata,
    ip,
    userAgent,
  }, repositories);
}

export function createSecurityMonitor({
  repositories = null,
  now = () => Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
  threshold = DEFAULT_THRESHOLD,
} = {}) {
  const signals = new Map();
  const limit = Math.max(2, Number(threshold) || DEFAULT_THRESHOLD);
  const window = Math.max(10_000, Number(windowMs) || DEFAULT_WINDOW_MS);

  function prune(timestamp) {
    for (const [key, signal] of signals) {
      if (timestamp - signal.firstAt > window) signals.delete(key);
    }
  }

  async function record(event = {}) {
    const type = normalizedType(event.type);
    const result = await recordSecurityEvent({ ...event, type }, repositories);
    if (!repositories?.auditEvents || !['login_failed', 'login_blocked', 'permission_denied'].includes(type)) {
      return result;
    }
    const timestamp = now();
    prune(timestamp);
    const subject = String(event.actor?.uid || event.ip || 'anonymous').slice(0, 160);
    const key = `${type}:${subject}`;
    const current = signals.get(key) || { firstAt: timestamp, count: 0, alertedAt: 0 };
    current.count += 1;
    signals.set(key, current);
    if (current.count >= limit && (current.alertedAt === 0 || current.count - current.alertedAt >= limit)) {
      current.alertedAt = current.count;
      await recordSecurityEvent({
        type: 'anomaly_detected',
        actor: event.actor,
        clientId: event.clientId,
        metadata: {
          signal: type,
          subject,
          count: current.count,
          windowMs: window,
        },
        ip: event.ip,
        userAgent: event.userAgent,
      }, repositories);
    }
    return result;
  }

  return Object.freeze({ record, policy: Object.freeze({ windowMs: window, threshold: limit }) });
}
