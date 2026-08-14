import { makeId } from './store.js';

export const PUBLISH_ATTEMPT_HISTORY_LIMIT = 20;

export function classifyPublishError(error = {}) {
  const message = String(error.message || '').toLowerCase();
  const status = Number(error.status || error.statusCode || 0);
  if (/public_media|media|image|video|upload|url/.test(message)) return 'media';
  if (/token|auth|oauth|permission|access denied|credential/.test(message)) return 'authentication';
  if (error.retriable || status === 408 || status === 429 || status >= 500) return 'temporary';
  if (status === 400 || status === 422) return 'validation';
  if (/facebook|instagram|threads|graph api/.test(message)) return 'platform';
  return 'unknown';
}

export function serializePublishError(error = {}) {
  return {
    message: error.message || '發布失敗。',
    category: classifyPublishError(error),
    status: error.status || error.statusCode,
    retriable: Boolean(error.retriable),
    code: error.code,
    subcode: error.subcode,
    traceId: error.traceId,
    externalId: error.externalId || null,
    at: new Date().toISOString(),
  };
}

export function createPublishAttempt({
  source = 'manual',
  idempotencyKey = '',
  now = new Date(),
  idFactory = makeId,
} = {}) {
  return {
    id: idFactory(),
    source,
    idempotencyKey: String(idempotencyKey || ''),
    status: 'started',
    startedAt: now.toISOString(),
    finishedAt: null,
    externalId: null,
    error: null,
  };
}

export function appendPublishAttempt(target, attempt) {
  const attempts = Array.isArray(target.publishAttempts) ? target.publishAttempts : [];
  target.publishAttempts = [...attempts, attempt].slice(-PUBLISH_ATTEMPT_HISTORY_LIMIT);
  target.lastAttemptId = attempt.id;
  return target;
}

export function updatePublishAttempt(target, attemptId, updates = {}) {
  if (!attemptId || !Array.isArray(target.publishAttempts)) return target;
  const attempt = target.publishAttempts.find((item) => item.id === attemptId);
  if (attempt) Object.assign(attempt, updates);
  return target;
}
