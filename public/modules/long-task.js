export const PENDING_LONG_TASK_KEY = 'shrineflow.longTask';

export function isTransientNetworkError(error = {}) {
  if (Number(error.status) > 0) return false;
  const name = String(error.name || '');
  const message = String(error.message || '');
  return name === 'AbortError'
    || name === 'TypeError'
    || /failed to fetch|networkerror|load failed|the user aborted|network request failed|fetch failed/i.test(message);
}

export function isPublishInProgressError(error = {}) {
  if (Number(error.status) !== 409) return false;
  return /發布中|排程或發布中|已經處理過/i.test(String(error.message || ''));
}

export function writePendingLongTask(task, storage = globalThis.sessionStorage) {
  if (!storage?.setItem || !task) return;
  storage.setItem(PENDING_LONG_TASK_KEY, JSON.stringify(task));
}

export function readPendingLongTask(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem?.(PENDING_LONG_TASK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingLongTask(storage = globalThis.sessionStorage) {
  storage?.removeItem?.(PENDING_LONG_TASK_KEY);
}

function visibilityOf(documentRef) {
  return documentRef?.visibilityState || 'visible';
}

export function whenDocumentVisible(documentRef = globalThis.document) {
  if (visibilityOf(documentRef) !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (visibilityOf(documentRef) !== 'hidden') {
        documentRef.removeEventListener?.('visibilitychange', onChange);
        resolve();
      }
    };
    documentRef.addEventListener?.('visibilitychange', onChange);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForBackgroundJob(jobId, {
  api,
  type = 'generate',
  document: documentRef = globalThis.document,
  intervalMs = 1_000,
  timeoutMs = 300_000,
  now = Date.now,
  storage = globalThis.sessionStorage,
} = {}) {
  if (!jobId) throw new Error('缺少背景工作識別碼。');
  if (typeof api !== 'function') throw new Error('api is required');
  writePendingLongTask({ type, jobId }, storage);
  const started = now();
  while (now() - started < timeoutMs) {
    await whenDocumentVisible(documentRef);
    try {
      const job = await api(`/api/generate/jobs/${encodeURIComponent(jobId)}`);
      if (job.status === 'succeeded') {
        clearPendingLongTask(storage);
        return job.result || job;
      }
      if (job.status === 'failed') {
        clearPendingLongTask(storage);
        const error = new Error(job.error?.message || '背景工作失敗。');
        error.status = job.error?.status;
        error.code = job.error?.code;
        throw error;
      }
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
    }
    await whenDocumentVisible(documentRef);
    await sleep(intervalMs);
  }
  throw new Error('等待結果逾時，請重新整理後再試。');
}

export function resolvePublishOutcome(post, targetId) {
  const target = (post?.targets || []).find((item) => item.id === targetId) || null;
  if (!target) return { state: 'missing', target: null };
  if (target.status === 'published') return { state: 'succeeded', target };
  if (target.status === 'failed') return { state: 'failed', target };
  if (['publishing', 'pending'].includes(target.status)) return { state: 'running', target };
  return { state: 'idle', target };
}

export async function waitForPublishTarget({
  postId,
  targetId,
  loadPost,
  document: documentRef = globalThis.document,
  intervalMs = 1_000,
  timeoutMs = 300_000,
  idleGraceMs = 15_000,
  now = Date.now,
  storage = globalThis.sessionStorage,
} = {}) {
  if (typeof loadPost !== 'function') throw new Error('loadPost is required');
  writePendingLongTask({ type: 'publish', postId, targetId }, storage);
  const started = now();
  while (now() - started < timeoutMs) {
    await whenDocumentVisible(documentRef);
    try {
      const post = await loadPost();
      const outcome = resolvePublishOutcome(post, targetId);
      if (outcome.state === 'succeeded') {
        clearPendingLongTask(storage);
        return outcome.target;
      }
      if (outcome.state === 'failed') {
        clearPendingLongTask(storage);
        const error = new Error(outcome.target?.lastError?.message || '發布失敗。');
        error.status = outcome.target?.lastError?.status;
        error.data = { lastError: outcome.target?.lastError };
        throw error;
      }
      if (outcome.state === 'missing' || (outcome.state === 'idle' && now() - started > idleGraceMs)) {
        clearPendingLongTask(storage);
        throw new Error('發布沒有開始，請再試一次。');
      }
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
    }
    await whenDocumentVisible(documentRef);
    await sleep(intervalMs);
  }
  throw new Error('等待發布結果逾時，請到內容列表確認狀態。');
}

export async function startAndWaitGenerate(formData, { api, ...waitOptions } = {}) {
  const started = await api('/api/generate', { method: 'POST', body: formData });
  if (started?.jobId) return waitForBackgroundJob(started.jobId, { api, ...waitOptions });
  return started;
}

export async function startAndWaitRewrite(payload, { api, ...waitOptions } = {}) {
  const started = await api('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (started?.copy) return started;
  if (started?.jobId) return waitForBackgroundJob(started.jobId, { api, type: 'rewrite', ...waitOptions });
  return started;
}

export async function publishTargetWithRecovery({
  api,
  postId,
  targetId,
  source = '',
  createIdempotencyKey,
  loadPost,
  ...waitOptions
} = {}) {
  const idempotencyKey = typeof createIdempotencyKey === 'function'
    ? createIdempotencyKey()
    : `sf-${Date.now()}`;
  writePendingLongTask({ type: 'publish', postId, targetId, idempotencyKey }, waitOptions.storage);
  try {
    const result = await api('/api/publish/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ postId, targetId, ...(source ? { source } : {}) }),
    });
    clearPendingLongTask(waitOptions.storage);
    return result;
  } catch (error) {
    if (!isTransientNetworkError(error) && !isPublishInProgressError(error)) throw error;
    return waitForPublishTarget({ postId, targetId, loadPost, ...waitOptions });
  }
}
