import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serializeJsonWithinLimit } from './storage-policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const directories = {
  data: path.join(rootDir, 'data'),
  uploads: path.join(rootDir, 'uploads'),
  prompts: path.join(rootDir, 'prompts'),
  publishAttempts: path.join(rootDir, 'data', 'publish-attempts'),
  postVersions: path.join(rootDir, 'data', 'post-versions'),
  insights: path.join(rootDir, 'data', 'insights'),
  backups: path.join(rootDir, 'data', 'backups'),
};

export const jsonFiles = {
  gods: path.join(directories.data, 'gods.json'),
  posts: path.join(directories.data, 'posts.json'),
  schedule: path.join(directories.data, 'schedule.json'),
  clients: path.join(directories.data, 'clients.json'),
  templates: path.join(directories.data, 'templates.json'),
  campaigns: path.join(directories.data, 'campaigns.json'),
  inboxMetadata: path.join(directories.data, 'inbox-metadata.json'),
  notifications: path.join(directories.data, 'notifications.json'),
  errorLog: path.join(directories.data, 'error-log.json'),
  mediaAssets: path.join(directories.data, 'media-assets.json'),
  users: path.join(directories.data, 'users.json'),
  memberships: path.join(directories.data, 'memberships.json'),
  invitations: path.join(directories.data, 'invitations.json'),
  auditEvents: path.join(directories.data, 'audit-events.json'),
};

export const STORAGE_POLICY = Object.freeze({
  lockTimeoutMs: 15_000,
  lockLeaseMs: 120_000,
  retryDelayMs: 25,
  recoveryBackupCount: 1,
});

export async function initStorage() {
  for (const directory of Object.values(directories)) {
    await fs.mkdir(directory, { recursive: true });
  }
  await ensureJsonFile(jsonFiles.gods, []);
  await ensureJsonFile(jsonFiles.posts, []);
  await ensureJsonFile(jsonFiles.schedule, []);
  await ensureJsonFile(jsonFiles.clients, []);
  await ensureJsonFile(jsonFiles.templates, []);
  await ensureJsonFile(jsonFiles.campaigns, []);
  await ensureJsonFile(jsonFiles.inboxMetadata, { version: 1, items: {}, cursors: {} });
  await ensureJsonFile(jsonFiles.notifications, { version: 1, items: [] });
  await ensureJsonFile(jsonFiles.errorLog, { version: 1, items: [] });
  await ensureJsonFile(jsonFiles.mediaAssets, []);
  await ensureJsonFile(jsonFiles.users, []);
  await ensureJsonFile(jsonFiles.memberships, []);
  await ensureJsonFile(jsonFiles.invitations, []);
  await ensureJsonFile(jsonFiles.auditEvents, []);
}

export async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJson(filePath, fallback);
  }
}

async function parseJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function readJson(filePath, fallback = []) {
  try {
    return await parseJsonFile(filePath);
  } catch {
    try {
      return await parseJsonFile(`${filePath}.bak`);
    } catch {
      return fallback;
    }
  }
}

function lockFilePath(filePath) {
  return `${filePath}.lock`;
}

function recoveryBackupPath(filePath) {
  return `${filePath}.bak`;
}

function temporaryFilePath(filePath, suffix = 'tmp') {
  return `${filePath}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.${suffix}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readLockRecord(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function acquireJsonLock(filePath, {
  timeoutMs = STORAGE_POLICY.lockTimeoutMs,
  leaseMs = STORAGE_POLICY.lockLeaseMs,
} = {}) {
  const lockPath = lockFilePath(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');
  const startedAt = Date.now();

  while (true) {
    const expiresAt = Date.now() + leaseMs;
    const lockRecord = {
      pid: process.pid,
      hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
      token,
      createdAt: new Date().toISOString(),
      expiresAt,
    };
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify(lockRecord), 'utf8');
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const current = await readLockRecord(lockPath);
        if (current?.token === token) await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;

      const current = await readLockRecord(lockPath);
      if (!current || !Number.isFinite(Number(current.expiresAt)) || Number(current.expiresAt) <= Date.now()) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const lockError = new Error('儲存檔案目前正在被其他程序使用，請稍後再試。');
        lockError.code = 'STORAGE_LOCK_TIMEOUT';
        lockError.status = 503;
        throw lockError;
      }
      await wait(STORAGE_POLICY.retryDelayMs);
    }
  }
}

async function withJsonLock(filePath, operation) {
  const release = await acquireJsonLock(filePath);
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function writeJsonUnlocked(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryFilePath(filePath, 'tmp');
  const backupPath = recoveryBackupPath(filePath);
  const backupTemporaryPath = temporaryFilePath(filePath, 'bak-tmp');
  const { serialized } = serializeJsonWithinLimit(filePath, value);
  try {
    try {
      const current = await fs.readFile(filePath, 'utf8');
      JSON.parse(current);
      await fs.copyFile(filePath, backupTemporaryPath);
      await fs.rm(backupPath, { force: true });
      await fs.rename(backupTemporaryPath, backupPath);
    } catch {
      await fs.rm(backupTemporaryPath, { force: true }).catch(() => {});
    }

    await fs.writeFile(temporaryPath, serialized, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    await fs.rm(backupTemporaryPath, { force: true }).catch(() => {});
  }
}

export async function writeJson(filePath, value) {
  return withJsonLock(filePath, () => writeJsonUnlocked(filePath, value));
}

const jsonMutationQueues = new Map();

export function mutateJson(filePath, mutator, fallback = []) {
  const previous = jsonMutationQueues.get(filePath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => withJsonLock(filePath, async () => {
    const value = await readJson(filePath, fallback);
    const result = await mutator(value);
    await writeJsonUnlocked(filePath, value);
    return result;
  }));
  jsonMutationQueues.set(filePath, operation);
  return operation;
}

export function makeId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}
