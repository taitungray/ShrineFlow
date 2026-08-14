import { jsonFiles, readJson, mutateJson, writeJson } from './store.js';

/**
 * Repository contract used by the application services and route modules.
 *
 * The first implementation intentionally keeps the existing JSON shape so the
 * local app and migration tools remain compatible. A Firestore implementation
 * can replace these methods without making routes know about files.
 */
export const REPOSITORY_SCHEMA_VERSION = 1;

function cloneFallback(value) {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function normalizeCollection(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : cloneFallback(fallback);
  return value && typeof value === 'object' ? value : cloneFallback(fallback);
}

export function createLocalJsonRepository({ name, filePath, fallback = [] }) {
  if (!name) throw new Error('Repository name is required.');
  if (!filePath) throw new Error(`Repository file path is required for ${name}.`);

  return Object.freeze({
    name,
    backend: 'local-json',
    schemaVersion: REPOSITORY_SCHEMA_VERSION,

    async list() {
      return normalizeCollection(await readJson(filePath, fallback), fallback);
    },

    async getById(id) {
      const records = await this.list();
      if (!Array.isArray(records)) return null;
      return records.find((record) => record?.id === id) || null;
    },

    async mutate(mutator) {
      return mutateJson(filePath, async (records) => {
        const collection = normalizeCollection(records, fallback);
        if (collection !== records && Array.isArray(records)) {
          records.splice(0, records.length, ...collection);
        }
        return mutator(collection);
      }, fallback);
    },

    async replace(value) {
      const normalized = normalizeCollection(value, fallback);
      await writeJson(filePath, normalized);
      return normalized;
    },
  });
}

export function createLocalRepositories({ files = jsonFiles } = {}) {
  return Object.freeze({
    backend: 'local-json',
    schemaVersion: REPOSITORY_SCHEMA_VERSION,
    posts: createLocalJsonRepository({ name: 'posts', filePath: files.posts, fallback: [] }),
    schedule: createLocalJsonRepository({ name: 'schedule', filePath: files.schedule, fallback: [] }),
    clients: createLocalJsonRepository({ name: 'clients', filePath: files.clients, fallback: [] }),
    templates: createLocalJsonRepository({ name: 'templates', filePath: files.templates, fallback: [] }),
    campaigns: createLocalJsonRepository({ name: 'campaigns', filePath: files.campaigns, fallback: [] }),
    gods: createLocalJsonRepository({ name: 'gods', filePath: files.gods, fallback: [] }),
    inboxMetadata: createLocalJsonRepository({
      name: 'inboxMetadata',
      filePath: files.inboxMetadata,
      fallback: { version: 1, items: {}, cursors: {} },
    }),
    notifications: createLocalJsonRepository({
      name: 'notifications',
      filePath: files.notifications,
      fallback: { version: 1, items: [] },
    }),
    errorLog: createLocalJsonRepository({
      name: 'errorLog',
      filePath: files.errorLog,
      fallback: { version: 1, items: [] },
    }),
  });
}

let defaultRepositories;

export function getRepositories() {
  if (!defaultRepositories) {
    const backend = String(process.env.SHRINEFLOW_STORAGE_BACKEND || 'local-json').trim().toLowerCase();
    if (backend !== 'local-json') {
      const error = new Error(`尚未支援資料儲存後端「${backend}」；目前只能使用 local-json。`);
      error.code = 'STORAGE_BACKEND_UNAVAILABLE';
      throw error;
    }
    defaultRepositories = createLocalRepositories();
  }
  return defaultRepositories;
}

export function resetRepositoriesForTests() {
  defaultRepositories = undefined;
}
