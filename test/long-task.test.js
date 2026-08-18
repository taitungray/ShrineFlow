import test from 'node:test';
import assert from 'node:assert/strict';

function installSessionStorage() {
  const memory = new Map();
  const storage = {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(String(key));
    },
  };
  globalThis.sessionStorage = storage;
  return storage;
}

function createVisibilityDocument(initial = 'visible') {
  const listeners = [];
  const documentRef = {
    visibilityState: initial,
    addEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.push(handler);
    },
    removeEventListener(type, handler) {
      const index = listeners.indexOf(handler);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  return {
    document: documentRef,
    show() {
      documentRef.visibilityState = 'visible';
      listeners.slice().forEach((handler) => handler());
    },
    hide() {
      documentRef.visibilityState = 'hidden';
      listeners.slice().forEach((handler) => handler());
    },
  };
}

test('isTransientNetworkError treats aborted fetches as recoverable', async () => {
  const { isTransientNetworkError } = await import('../public/modules/long-task.js');
  assert.equal(isTransientNetworkError({ name: 'AbortError', message: 'The user aborted a request.' }), true);
  assert.equal(isTransientNetworkError({ name: 'TypeError', message: 'Failed to fetch' }), true);
  assert.equal(isTransientNetworkError({ status: 500, message: '發布失敗' }), false);
});

test('waitForBackgroundJob keeps polling after the tab returns from background', async () => {
  installSessionStorage();
  const visibility = createVisibilityDocument('hidden');
  let calls = 0;
  const { waitForBackgroundJob } = await import('../public/modules/long-task.js');
  const promise = waitForBackgroundJob('job-1', {
    api: async () => {
      calls += 1;
      if (calls === 1) return { status: 'running' };
      return { status: 'succeeded', result: { facebook: '回來後完成' } };
    },
    document: visibility.document,
    intervalMs: 10,
    timeoutMs: 500,
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 0);
  visibility.show();
  const result = await promise;
  assert.equal(result.facebook, '回來後完成');
  assert.ok(calls >= 2);
});

test('waitForPublishTarget treats publishing as in-progress and published as success', async () => {
  const { resolvePublishOutcome, waitForPublishTarget } = await import('../public/modules/long-task.js');
  assert.equal(resolvePublishOutcome({
    targets: [{ id: 't1', status: 'publishing' }],
  }, 't1').state, 'running');
  assert.equal(resolvePublishOutcome({
    targets: [{ id: 't1', status: 'published', externalId: 'ext-1' }],
  }, 't1').state, 'succeeded');

  let calls = 0;
  const result = await waitForPublishTarget({
    postId: 'post-1',
    targetId: 't1',
    loadPost: async () => {
      calls += 1;
      if (calls === 1) return { id: 'post-1', targets: [{ id: 't1', status: 'publishing' }] };
      return { id: 'post-1', targets: [{ id: 't1', status: 'published', externalId: 'ext-1' }] };
    },
    intervalMs: 10,
    timeoutMs: 500,
    document: createVisibilityDocument('visible').document,
  });
  assert.equal(result.externalId, 'ext-1');
});

test('pending long-task snapshot survives a background round-trip', async () => {
  const storage = installSessionStorage();
  const { writePendingLongTask, readPendingLongTask, clearPendingLongTask } = await import('../public/modules/long-task.js');
  writePendingLongTask({ type: 'generate', jobId: 'job-9' }, storage);
  const pending = readPendingLongTask(storage);
  assert.equal(pending.type, 'generate');
  assert.equal(pending.jobId, 'job-9');
  assert.equal(typeof pending.startedAt, 'number');
  clearPendingLongTask(storage);
  assert.equal(readPendingLongTask(storage), null);
});

test('waitForBackgroundJob timeout clears pending and tells the user to generate again', async () => {
  const storage = installSessionStorage();
  const { waitForBackgroundJob, readPendingLongTask } = await import('../public/modules/long-task.js');
  await assert.rejects(
    () => waitForBackgroundJob('job-timeout', {
      api: async () => ({ status: 'running' }),
      intervalMs: 5,
      timeoutMs: 20,
      storage,
      document: createVisibilityDocument('visible').document,
    }),
    (error) => {
      assert.match(error.message, /逾時|再按一次/);
      assert.doesNotMatch(error.message, /重新整理/);
      return true;
    },
  );
  assert.equal(readPendingLongTask(storage), null);
});

test('waitForBackgroundJob honors persisted startedAt so refresh cannot reset the timeout', async () => {
  const storage = installSessionStorage();
  const { writePendingLongTask, waitForBackgroundJob, readPendingLongTask } = await import('../public/modules/long-task.js');
  writePendingLongTask({ type: 'generate', jobId: 'job-stale', startedAt: Date.now() - 10_000 }, storage);
  let calls = 0;
  await assert.rejects(
    () => waitForBackgroundJob('job-stale', {
      api: async () => {
        calls += 1;
        return { status: 'running' };
      },
      intervalMs: 5,
      timeoutMs: 50,
      storage,
      document: createVisibilityDocument('visible').document,
    }),
    /逾時|中斷|再按一次/,
  );
  assert.equal(calls, 0);
  assert.equal(readPendingLongTask(storage), null);
});

test('waitForBackgroundJob treats a missing job as terminal and clears pending', async () => {
  const storage = installSessionStorage();
  const { waitForBackgroundJob, readPendingLongTask } = await import('../public/modules/long-task.js');
  const missing = new Error('找不到這項背景工作。');
  missing.status = 404;
  missing.code = 'JOB_NOT_FOUND';
  await assert.rejects(
    () => waitForBackgroundJob('job-gone', {
      api: async () => {
        throw missing;
      },
      intervalMs: 5,
      timeoutMs: 200,
      storage,
      document: createVisibilityDocument('visible').document,
    }),
    (error) => {
      assert.equal(error.status, 404);
      assert.match(error.message, /中斷|再按一次|找不到/);
      return true;
    },
  );
  assert.equal(readPendingLongTask(storage), null);
});

test('waitForBackgroundJob times out even if the tab stays hidden', async () => {
  const storage = installSessionStorage();
  const visibility = createVisibilityDocument('hidden');
  const { waitForBackgroundJob, readPendingLongTask } = await import('../public/modules/long-task.js');
  await assert.rejects(
    () => waitForBackgroundJob('job-hidden', {
      api: async () => ({ status: 'running' }),
      intervalMs: 5,
      timeoutMs: 30,
      storage,
      document: visibility.document,
    }),
    /逾時|再按一次/,
  );
  assert.equal(readPendingLongTask(storage), null);
});

test('waitForBackgroundJob abort clears pending so the composer can unlock', async () => {
  const storage = installSessionStorage();
  const { waitForBackgroundJob, readPendingLongTask } = await import('../public/modules/long-task.js');
  const controller = new AbortController();
  const promise = waitForBackgroundJob('job-cancel', {
    api: async () => ({ status: 'running' }),
    intervalMs: 15,
    timeoutMs: 500,
    storage,
    signal: controller.signal,
    document: createVisibilityDocument('visible').document,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await assert.rejects(promise, /取消/);
  assert.equal(readPendingLongTask(storage), null);
});
