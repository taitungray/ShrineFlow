import { jsonFiles, readJson, mutateJson, writeJson } from './store.js';
import {
  createFirestoreClient,
  decodeFirestoreDocument,
  encodeFirestoreDocument,
  firestoreDeleteForDocument,
  firestoreDocumentName,
  firestoreWriteForDocument,
} from './firestore-rest.js';

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
    mediaAssets: createLocalJsonRepository({
      name: 'mediaAssets',
      filePath: files.mediaAssets,
      fallback: [],
    }),
  });
}

const FIRESTORE_COLLECTIONS = Object.freeze({
  posts: 'posts',
  schedule: 'schedule',
  clients: 'clients',
  templates: 'templates',
  campaigns: 'campaigns',
  gods: 'gods',
  inboxMetadata: 'inboxMetadata',
  notifications: 'notifications',
  errorLog: 'errorLog',
  mediaAssets: 'mediaAssets',
  postVersions: 'postVersions',
  publishAttempts: 'publishAttempts',
  insightsSnapshots: 'insightsSnapshots',
  auditEvents: 'auditEvents',
});

function normalizeFirestoreCollection(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : [];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { ...fallback };
}

function createFirestoreRepository({ name, collection, client, fallback = [] }) {
  if (!name || !collection || !client) throw new Error('Firestore repository configuration is incomplete for ' + name + '.');
  const singleton = !Array.isArray(fallback);

  function writesForValue(value, existingDocuments = []) {
    if (singleton) {
      const documentName = firestoreDocumentName(client, collection, 'state');
      return [firestoreWriteForDocument(encodeFirestoreDocument(value, documentName))];
    }

    const records = Array.isArray(value) ? value : [];
    const existing = new Map(existingDocuments.map((document) => [client.documentIdFromName(document.name), document.name]));
    const writes = records.map((record) => {
      const id = String(record?.id || '').trim() || 'record-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
      existing.delete(id);
      const documentName = firestoreDocumentName(client, collection, id);
      return firestoreWriteForDocument(encodeFirestoreDocument({ ...record, id }, documentName));
    });
    for (const documentName of existing.values()) writes.push(firestoreDeleteForDocument(documentName));
    return writes;
  }

  async function readCollection(transaction = '') {
    const documents = await client.listDocuments(collection, { transaction });
    if (singleton) {
      const document = documents.find((item) => client.documentIdFromName(item.name) === 'state') || documents[0];
      return document ? normalizeFirestoreCollection(decodeFirestoreDocument(document), fallback) : { ...fallback };
    }
    return documents.map((document) => decodeFirestoreDocument(document));
  }

  async function mutate(mutator) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const transaction = await client.beginTransaction();
        const existingDocuments = await client.listDocuments(collection, { transaction });
        const current = singleton
          ? await readCollection(transaction)
          : existingDocuments.map((document) => decodeFirestoreDocument(document));
        const result = await mutator(current);
        await client.commit(writesForValue(current, existingDocuments), transaction);
        return result;
      } catch (error) {
        if (error?.code !== 'ABORTED' || attempt >= 2) throw error;
      }
    }
    throw new Error('Firestore transaction failed after retries.');
  }

  return Object.freeze({
    name,
    backend: 'firestore',
    schemaVersion: REPOSITORY_SCHEMA_VERSION,
    collection,
    list: () => readCollection(),
    async getById(id) {
      if (singleton) return null;
      const document = await client.getDocument(collection, id);
      return document ? decodeFirestoreDocument(document) : null;
    },
    mutate,
    async replace(value) {
      const normalized = normalizeFirestoreCollection(value, fallback);
      const existingDocuments = await client.listDocuments(collection);
      await client.commit(writesForValue(normalized, existingDocuments));
      return normalized;
    },
  });
}

export function createFirestoreRepositories({ client = createFirestoreClient(), collections = FIRESTORE_COLLECTIONS } = {}) {
  const make = (name, fallback) => createFirestoreRepository({
    name,
    collection: collections[name] || name,
    client,
    fallback,
  });
  return Object.freeze({
    backend: 'firestore',
    schemaVersion: REPOSITORY_SCHEMA_VERSION,
    firestore: client,
    posts: make('posts', []),
    schedule: make('schedule', []),
    clients: make('clients', []),
    templates: make('templates', []),
    campaigns: make('campaigns', []),
    gods: make('gods', []),
    inboxMetadata: make('inboxMetadata', { version: 1, items: {}, cursors: {}, syncHints: {} }),
    notifications: make('notifications', { version: 1, items: [] }),
    errorLog: make('errorLog', { version: 1, items: [] }),
    mediaAssets: make('mediaAssets', []),
    postVersions: make('postVersions', []),
    publishAttempts: make('publishAttempts', []),
    insightsSnapshots: make('insightsSnapshots', []),
    auditEvents: make('auditEvents', []),
  });
}

let defaultRepositories;

export function getRepositories() {
  if (!defaultRepositories) {
    const backend = String(process.env.SHRINEFLOW_STORAGE_BACKEND || 'local-json').trim().toLowerCase();
    if (backend === 'firestore') {
      defaultRepositories = createFirestoreRepositories();
      return defaultRepositories;
    }
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
