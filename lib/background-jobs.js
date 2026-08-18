import { makeId } from './store.js';

export const BACKGROUND_JOB_TTL_MS = 60 * 60 * 1000;
export const BACKGROUND_JOB_RUN_TIMEOUT_MS = 4 * 60 * 1000;

function isTerminalJob(job) {
  return job?.status === 'succeeded' || job?.status === 'failed';
}

export function createBackgroundJobStore({
  now = () => Date.now(),
  ttlMs = BACKGROUND_JOB_TTL_MS,
  runTimeoutMs = BACKGROUND_JOB_RUN_TIMEOUT_MS,
} = {}) {
  const jobs = new Map();

  function prune(current = now()) {
    for (const [id, job] of jobs) {
      if (Number(job.expiresAt || 0) <= current) jobs.delete(id);
    }
  }

  function stamp(job, current = now()) {
    job.updatedAt = new Date(current).toISOString();
    job.expiresAt = current + ttlMs;
    return job;
  }

  function failIfStale(job, current = now()) {
    if (!job || isTerminalJob(job)) return job;
    const created = Date.parse(job.createdAt) || current;
    if (current - created < runTimeoutMs) return job;
    job.status = 'failed';
    job.result = null;
    job.error = {
      message: '文案產生逾時，請再按一次產生。',
      status: 504,
      code: 'JOB_TIMEOUT',
    };
    stamp(job, current);
    return job;
  }

  return {
    create(input = {}) {
      prune();
      const current = now();
      const record = stamp({
        id: String(input.id || makeId()),
        type: String(input.type || 'generate'),
        status: 'queued',
        clientId: input.clientId || '',
        input: input.input || null,
        result: null,
        error: null,
        createdAt: new Date(current).toISOString(),
      }, current);
      jobs.set(record.id, record);
      return { ...record };
    },

    get(id) {
      prune();
      const job = jobs.get(String(id || ''));
      if (!job) return null;
      failIfStale(job);
      return { ...job };
    },

    update(id, patch = {}) {
      prune();
      const current = jobs.get(String(id || ''));
      if (!current) return null;
      failIfStale(current);
      if (isTerminalJob(current)) return { ...current };
      Object.assign(current, patch, { id: current.id });
      stamp(current);
      return { ...current };
    },

    publicView(job) {
      if (!job) return null;
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        result: job.status === 'succeeded' ? job.result : null,
        error: job.status === 'failed' ? job.error : null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    },
  };
}

let defaultJobStore;

export function getBackgroundJobStore() {
  if (!defaultJobStore) defaultJobStore = createBackgroundJobStore();
  return defaultJobStore;
}

export function resetBackgroundJobStoreForTests() {
  defaultJobStore = undefined;
}
