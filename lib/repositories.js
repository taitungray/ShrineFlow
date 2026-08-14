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

export class RepositoryConflictError extends Error {
  constructor(message = '資料已被其他使用者更新，請重新載入。') {
    super(message);
    this.name = 'RepositoryConflictError';
    this.code = 'REPOSITORY_CONFLICT';
    this.status = 409;
  }
}

function queryRecords(records, {
  filters = {},
  orderBy = '',
  direction = 'asc',
  limit = 0,
} = {}) {
  let result = records.filter((record) => Object.entries(filters)
    .every(([key, value]) => value === undefined || record?.[key] === value));
  if (orderBy) {
    const multiplier = String(direction).toLowerCase() === 'desc' ? -1 : 1;
    result = result.slice().sort((left, right) => {
      if (left?.[orderBy] === right?.[orderBy]) return 0;
      return left?.[orderBy] > right?.[orderBy] ? multiplier : -multiplier;
    });
  }
  return Number(limit) > 0 ? result.slice(0, Math.floor(Number(limit))) : result;
}

async function applyRecordUpdate(current, updater) {
  const next = typeof updater === 'function'
    ? await updater({ ...current })
    : { ...current, ...(updater || {}) };
  return next && typeof next === 'object' ? { ...next, id: current.id } : null;
}

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

    async query(options = {}) {
      const records = await this.list();
      return Array.isArray(records) ? queryRecords(records, options) : [];
    },

    async create(record) {
      const id = String(record?.id || '').trim();
      if (!id) throw new Error(`${name} record id is required.`);
      return this.mutate((records) => {
        if (!Array.isArray(records)) throw new Error(`${name} does not support document create.`);
        if (records.some((item) => item?.id === id)) throw new RepositoryConflictError();
        const created = { ...record, id };
        records.push(created);
        return created;
      });
    },

    async update(id, updater, { expectedVersion = null } = {}) {
      return this.mutate(async (records) => {
        if (!Array.isArray(records)) throw new Error(`${name} does not support document update.`);
        const index = records.findIndex((record) => record?.id === id);
        if (index < 0) return null;
        const current = records[index];
        if (expectedVersion !== null && Number(current.version) !== Number(expectedVersion)) {
          throw new RepositoryConflictError();
        }
        const next = await applyRecordUpdate(current, updater);
        if (!next) return null;
        records[index] = next;
        return next;
      });
    },

    async deleteById(id) {
      return this.mutate((records) => {
        if (!Array.isArray(records)) throw new Error(`${name} does not support document delete.`);
        const index = records.findIndex((record) => record?.id === id);
        if (index < 0) return false;
        records.splice(index, 1);
        return true;
      });
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
    savedReplies: createLocalJsonRepository({ name: 'savedReplies', filePath: files.savedReplies, fallback: [] }),
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
    users: createLocalJsonRepository({ name: 'users', filePath: files.users, fallback: [] }),
    memberships: createLocalJsonRepository({ name: 'memberships', filePath: files.memberships, fallback: [] }),
    invitations: createLocalJsonRepository({ name: 'invitations', filePath: files.invitations, fallback: [] }),
    auditEvents: createLocalJsonRepository({ name: 'auditEvents', filePath: files.auditEvents, fallback: [] }),
  });
}

const FIRESTORE_COLLECTIONS = Object.freeze({
  posts: 'posts',
  schedule: 'schedule',
  clients: 'clients',
  templates: 'templates',
  campaigns: 'campaigns',
  savedReplies: 'savedReplies',
  gods: 'gods',
  inboxMetadata: 'inboxMetadata',
  notifications: 'notifications',
  errorLog: 'errorLog',
  mediaAssets: 'mediaAssets',
  postVersions: 'postVersions',
  publishAttempts: 'publishAttempts',
  insightsSnapshots: 'insightsSnapshots',
  auditEvents: 'auditEvents',
  users: 'users',
  memberships: 'memberships',
  invitations: 'invitations',
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
    async query(options = {}) {
      if (singleton) return [];
      const documents = typeof client.runQuery === 'function'
        ? await client.runQuery(collection, options)
        : await client.listDocuments(collection);
      const records = documents.map((document) => decodeFirestoreDocument(document));
      return typeof client.runQuery === 'function' ? records : queryRecords(records, options);
    },
    async create(record) {
      if (singleton) throw new Error(`${name} does not support document create.`);
      const id = String(record?.id || '').trim();
      if (!id) throw new Error(`${name} record id is required.`);
      const documentName = firestoreDocumentName(client, collection, id);
      try {
        await client.commit([firestoreWriteForDocument(
          encodeFirestoreDocument({ ...record, id }, documentName),
          { exists: false },
        )]);
      } catch (error) {
        if (['ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(error?.code)) {
          throw new RepositoryConflictError();
        }
        throw error;
      }
      return { ...record, id };
    },
    async update(id, updater, { expectedVersion = null } = {}) {
      if (singleton) throw new Error(`${name} does not support document update.`);
      const transaction = await client.beginTransaction();
      const document = await client.getDocument(collection, id, { transaction });
      if (!document) return null;
      const current = decodeFirestoreDocument(document);
      if (expectedVersion !== null && Number(current.version) !== Number(expectedVersion)) {
        throw new RepositoryConflictError();
      }
      const next = await applyRecordUpdate(current, updater);
      if (!next) return null;
      const documentName = firestoreDocumentName(client, collection, id);
      await client.commit([firestoreWriteForDocument(
        encodeFirestoreDocument(next, documentName),
        document.updateTime ? { updateTime: document.updateTime } : undefined,
      )], transaction);
      return next;
    },
    async deleteById(id) {
      if (singleton) throw new Error(`${name} does not support document delete.`);
      const document = await client.getDocument(collection, id);
      if (!document) return false;
      await client.commit([firestoreDeleteForDocument(document.name)]);
      return true;
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
    savedReplies: make('savedReplies', []),
    gods: make('gods', []),
    inboxMetadata: make('inboxMetadata', { version: 1, items: {}, cursors: {}, syncHints: {} }),
    notifications: make('notifications', { version: 1, items: [] }),
    errorLog: make('errorLog', { version: 1, items: [] }),
    mediaAssets: make('mediaAssets', []),
    postVersions: make('postVersions', []),
    publishAttempts: make('publishAttempts', []),
    insightsSnapshots: make('insightsSnapshots', []),
    auditEvents: make('auditEvents', []),
    users: make('users', []),
    memberships: make('memberships', []),
    invitations: make('invitations', []),
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
