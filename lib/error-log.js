import { jsonFiles, mutateJson, readJson } from './store.js';
import { getRepositories } from './repositories.js';

export const ERROR_LOG_RETENTION_POLICY = Object.freeze({
  maxItems: 500,
  maxAgeDays: 30,
  maxMessageLength: 500,
  maxDetailLength: 4000,
});

export const CLIENT_ERROR_SCOPES = Object.freeze(['client_js', 'client_network', 'client_resource']);

const CLIENT_INGEST_WINDOW_MS = 60_000;
const CLIENT_INGEST_MAX_PER_WINDOW = 30;
const ingestBuckets = new Map();

function trim(value, maxLength = ERROR_LOG_RETENTION_POLICY.maxMessageLength) {
  return String(value || '')
    .replace(/(access[_-]?token|page[_-]?access[_-]?token|api[_-]?key|authorization|bearer)\s*[:=]\s*([^\s&,]+)/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, maxLength);
}

function itemsOf(value) {
  return value && !Array.isArray(value) && Array.isArray(value.items) ? value.items : [];
}

function ageTimestamp(item) {
  const value = Date.parse(item?.lastSeenAt || item?.createdAt);
  return Number.isFinite(value) ? value : Date.now();
}

function pruneItems(items, now = Date.now()) {
  const cutoff = now - (ERROR_LOG_RETENTION_POLICY.maxAgeDays * 24 * 60 * 60 * 1000);
  return items
    .filter((item) => ageTimestamp(item) >= cutoff)
    .slice(-ERROR_LOG_RETENTION_POLICY.maxItems);
}

function safeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function httpStatusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cloudRepository() {
  try {
    const repositories = getRepositories();
    return repositories.backend === 'firestore' ? repositories.errorLog : null;
  } catch {
    return null;
  }
}

function mutateErrorLog(mutator) {
  const repository = cloudRepository();
  return repository
    ? repository.mutate(mutator)
    : mutateJson(jsonFiles.errorLog, mutator, { version: 1, items: [] });
}

export function normalizeErrorPath(path = '') {
  const raw = String(path || '').trim();
  try {
    if (/^https?:\/\//i.test(raw)) return trim(new URL(raw).pathname, 200);
  } catch {
    // Keep the raw path when URL parsing fails.
  }
  return trim(raw.split('?')[0].split('#')[0], 200);
}

export function errorFingerprint(entry = {}) {
  const method = trim(entry.method, 12).toUpperCase();
  const path = normalizeErrorPath(entry.path);
  const code = trim(entry.code, 80);
  const status = safeStatus(entry.status);
  if (status) return ['http', method, path, String(status), code].join('|');
  return [
    trim(entry.scope, 80),
    method,
    path,
    code,
    trim(entry.message, ERROR_LOG_RETENTION_POLICY.maxMessageLength),
  ].join('|');
}

export function shouldRecordHttpError(statusCode, path = '') {
  const status = Number(statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 599) return false;
  const normalized = normalizeErrorPath(path);
  if (normalized === '/api/healthz' || normalized === '/healthz') return false;
  if (normalized.endsWith('/system/readiness')) return false;
  if (normalized.endsWith('/system/client-errors')) return false;
  if (status === 401) return false;
  if (status === 403 && (normalized.startsWith('/api/auth/') || normalized.startsWith('/auth/'))) return false;
  if (status === 404 && (normalized === '/robots.txt' || normalized === '/sw.js' || normalized.startsWith('/.well-known/'))) {
    return false;
  }
  if (status < 500 && normalized.includes('/system/error-log') && normalized.endsWith('/resolve')) return false;
  return true;
}

function assertIngestRateLimit(actorId) {
  const key = String(actorId || 'anonymous');
  const now = Date.now();
  const recent = (ingestBuckets.get(key) || []).filter((timestamp) => now - timestamp < CLIENT_INGEST_WINDOW_MS);
  if (recent.length >= CLIENT_INGEST_MAX_PER_WINDOW) {
    throw httpStatusError('錯誤上報過於頻繁，請稍後再試。', 429);
  }
  recent.push(now);
  ingestBuckets.set(key, recent);
}

function buildEntry({
  scope = 'unknown',
  error,
  message,
  detail = '',
  method = '',
  path = '',
  status = null,
  platformId = '',
  code = '',
  retriable = false,
  durationMs = null,
  source = '',
} = {}) {
  const createdAt = new Date().toISOString();
  const normalizedScope = trim(scope, 80);
  const entry = {
    id: `error-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt,
    lastSeenAt: createdAt,
    count: 1,
    resolutionStatus: 'open',
    resolvedAt: null,
    source: source || (normalizedScope.startsWith('client_') ? 'client' : 'server'),
    scope: normalizedScope,
    method: trim(method, 12).toUpperCase(),
    path: normalizeErrorPath(path),
    status: safeStatus(status),
    platformId: trim(platformId, 40),
    code: trim(error?.code || code, 80),
    message: trim(error?.message || message, ERROR_LOG_RETENTION_POLICY.maxMessageLength),
    detail: trim(detail, ERROR_LOG_RETENTION_POLICY.maxDetailLength),
    retriable: Boolean(retriable || error?.retriable),
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.min(Number(durationMs), 86_400_000)) : null,
  };
  entry.fingerprint = errorFingerprint(entry);
  return entry;
}

function mergeEntry(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    createdAt: existing.createdAt,
    fingerprint: incoming.fingerprint || existing.fingerprint,
    count: Number(existing.count || 1) + 1,
    lastSeenAt: incoming.createdAt || new Date().toISOString(),
    resolutionStatus: 'open',
    resolvedAt: null,
    source: existing.source || incoming.source,
    detail: incoming.detail || existing.detail || '',
  };
}

export async function appendErrorLog(input = {}) {
  const entry = buildEntry(input);
  try {
    const stored = await mutateErrorLog((record) => {
      record.version = 1;
      const items = pruneItems(itemsOf(record));
      const index = items.findIndex((item) => (item.fingerprint || errorFingerprint(item)) === entry.fingerprint);
      if (index >= 0) {
        items[index] = mergeEntry(items[index], entry);
        record.items = items.slice(-ERROR_LOG_RETENTION_POLICY.maxItems);
        return items[index];
      }
      record.items = [...items, entry].slice(-ERROR_LOG_RETENTION_POLICY.maxItems);
      return entry;
    });
    return stored || entry;
  } catch {
    // Error recording must never replace the original request or scheduler error.
    return entry;
  }
}

export async function listErrorLogs({ limit = 50, scope = '', status = 'all' } = {}) {
  const record = await (cloudRepository()?.list() || readJson(jsonFiles.errorLog, { version: 1, items: [] }));
  const resolutionFilter = String(status || 'all').toLowerCase();
  const filtered = pruneItems(itemsOf(record)).filter((item) => {
    if (scope && item.scope !== scope) return false;
    const resolution = item.resolutionStatus === 'fixed' ? 'fixed' : 'open';
    if (resolutionFilter && resolutionFilter !== 'all' && resolution !== resolutionFilter) return false;
    return true;
  });
  filtered.sort((left, right) => ageTimestamp(right) - ageTimestamp(left));
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), ERROR_LOG_RETENTION_POLICY.maxItems);
  return filtered.slice(0, safeLimit);
}

export async function exportErrorLogs({ status = 'all' } = {}) {
  const items = await listErrorLogs({
    limit: ERROR_LOG_RETENTION_POLICY.maxItems,
    status,
  });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
  };
}

export async function resolveErrorLog(id) {
  const targetId = String(id || '').trim();
  if (!targetId) return null;
  try {
    return await mutateErrorLog((record) => {
      record.version = 1;
      record.items = pruneItems(itemsOf(record));
      const item = record.items.find((entry) => entry.id === targetId);
      if (!item) return null;
      item.resolutionStatus = 'fixed';
      item.resolvedAt = new Date().toISOString();
      return item;
    });
  } catch {
    return null;
  }
}

export async function ingestClientError(payload = {}, { actorId = '' } = {}) {
  const scope = trim(payload.scope, 80);
  if (!CLIENT_ERROR_SCOPES.includes(scope)) {
    throw httpStatusError('不支援的錯誤來源。', 400);
  }
  assertIngestRateLimit(actorId);
  return appendErrorLog({
    scope,
    method: payload.method,
    path: payload.path,
    status: payload.status,
    code: payload.code,
    message: payload.message,
    detail: payload.detail,
    source: 'client',
  });
}

export async function getErrorLogStats() {
  const record = await (cloudRepository()?.list() || readJson(jsonFiles.errorLog, { version: 1, items: [] }));
  return { count: pruneItems(itemsOf(record)).length };
}
