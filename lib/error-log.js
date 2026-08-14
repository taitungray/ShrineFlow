import { jsonFiles, mutateJson, readJson } from './store.js';
import { getRepositories } from './repositories.js';

export const ERROR_LOG_RETENTION_POLICY = Object.freeze({
  maxItems: 500,
  maxAgeDays: 30,
  maxMessageLength: 500,
});

function trim(value, maxLength = ERROR_LOG_RETENTION_POLICY.maxMessageLength) {
  return String(value || '')
    .replace(/(access[_-]?token|page[_-]?access[_-]?token|api[_-]?key|authorization|bearer)\s*[:=]\s*([^\s&,]+)/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, maxLength);
}

function itemsOf(value) {
  return value && !Array.isArray(value) && Array.isArray(value.items) ? value.items : [];
}

function pruneItems(items, now = Date.now()) {
  const cutoff = now - (ERROR_LOG_RETENTION_POLICY.maxAgeDays * 24 * 60 * 60 * 1000);
  return items
    .filter((item) => !Number.isFinite(Date.parse(item.createdAt)) || Date.parse(item.createdAt) >= cutoff)
    .slice(-ERROR_LOG_RETENTION_POLICY.maxItems);
}

function safeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function cloudRepository() {
  try {
    const repositories = getRepositories();
    return repositories.backend === 'firestore' ? repositories.errorLog : null;
  } catch {
    return null;
  }
}

export async function appendErrorLog({
  scope = 'unknown',
  error,
  message,
  method = '',
  path = '',
  status = null,
  platformId = '',
  retriable = false,
  durationMs = null,
} = {}) {
  const entry = {
    id: `error-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    scope: trim(scope, 80),
    method: trim(method, 12).toUpperCase(),
    path: trim(path, 200),
    status: safeStatus(status),
    platformId: trim(platformId, 40),
    code: trim(error?.code, 80),
    message: trim(error?.message || message, ERROR_LOG_RETENTION_POLICY.maxMessageLength),
    retriable: Boolean(retriable || error?.retriable),
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.min(Number(durationMs), 86_400_000)) : null,
  };

  try {
    const repository = cloudRepository();
    const mutate = repository
      ? (mutator) => repository.mutate(mutator)
      : (mutator) => mutateJson(jsonFiles.errorLog, mutator, { version: 1, items: [] });
    await mutate((record) => {
      record.version = 1;
      record.items = [...pruneItems(itemsOf(record)), entry].slice(-ERROR_LOG_RETENTION_POLICY.maxItems);
      return entry;
    });
  } catch {
    // Error recording must never replace the original request or scheduler error.
  }
  return entry;
}

export async function listErrorLogs({ limit = 50, scope = '' } = {}) {
  const record = await (cloudRepository()?.list() || readJson(jsonFiles.errorLog, { version: 1, items: [] }));
  const filtered = pruneItems(itemsOf(record)).filter((item) => !scope || item.scope === scope);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), ERROR_LOG_RETENTION_POLICY.maxItems);
  return filtered.slice(-safeLimit).reverse();
}

export async function getErrorLogStats() {
  const record = await (cloudRepository()?.list() || readJson(jsonFiles.errorLog, { version: 1, items: [] }));
  return { count: pruneItems(itemsOf(record)).length };
}
