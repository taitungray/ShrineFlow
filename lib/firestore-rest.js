import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const DEFAULT_DATABASE = '(default)';
const DEFAULT_TOKEN_TTL_MS = 50 * 60 * 1000;

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function documentIdFromName(name) {
  const parts = String(name || '').split('/');
  return decodeURIComponent(parts[parts.length - 1] || '');
}

export function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: 'NULL_VALUE' };
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'bigint') return { integerValue: value.toString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { bytesValue: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) fields[key] = encodeFirestoreValue(item);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreValue(value = {}) {
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'bytesValue')) return Buffer.from(value.bytesValue, 'base64');
  if (Object.prototype.hasOwnProperty.call(value, 'referenceValue')) return value.referenceValue;
  if (Object.prototype.hasOwnProperty.call(value, 'geoPointValue')) return value.geoPointValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]),
    );
  }
  return null;
}

export function encodeFirestoreDocument(value = {}, name = '') {
  return {
    ...(name ? { name } : {}),
    fields: Object.fromEntries(
      Object.entries(value || {})
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, encodeFirestoreValue(item)]),
    ),
  };
}

export function decodeFirestoreDocument(document = {}) {
  const value = Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]),
  );
  if (document.name) value.id = value.id || documentIdFromName(document.name);
  return value;
}

export class FirestoreConfigurationError extends Error {
  constructor(message, code = 'FIRESTORE_CONFIGURATION_ERROR') {
    super(message);
    this.name = 'FirestoreConfigurationError';
    this.code = code;
    this.status = 503;
  }
}

async function readServiceAccount(env) {
  const raw = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new FirestoreConfigurationError('GOOGLE_SERVICE_ACCOUNT_JSON is invalid: ' + error.message);
    }
  }
  const credentialsPath = String(env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!credentialsPath) return null;
  try {
    return JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
  } catch (error) {
    throw new FirestoreConfigurationError('Unable to read Google credentials: ' + error.message);
  }
}

function createServiceAccountJwt(serviceAccount, now) {
  const issuedAt = Math.floor(now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = header + '.' + payload;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return unsigned + '.' + signer.sign(serviceAccount.private_key, 'base64url');
}

export function createFirestoreClient({
  env = process.env,
  projectId = env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || '',
  databaseId = env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE,
  apiBaseUrl = env.FIRESTORE_API_BASE_URL || 'https://firestore.googleapis.com/v1',
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
} = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedDatabaseId = String(databaseId || DEFAULT_DATABASE).trim() || DEFAULT_DATABASE;
  if (!normalizedProjectId) {
    throw new FirestoreConfigurationError(
      'Firestore requires FIRESTORE_PROJECT_ID or GOOGLE_CLOUD_PROJECT.',
      'FIRESTORE_PROJECT_ID_REQUIRED',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new FirestoreConfigurationError('Firestore requires a fetch implementation.', 'FIRESTORE_FETCH_REQUIRED');
  }

  const root = String(apiBaseUrl).replace(/\/$/, '')
    + '/projects/' + encodeURIComponent(normalizedProjectId)
    + '/databases/' + encodeURIComponent(normalizedDatabaseId) + '/documents';
  let serviceAccountPromise;
  let cachedToken = '';
  let cachedTokenExpiresAt = 0;

  async function resolveAccessToken() {
    const explicit = String(env.SHRINEFLOW_FIRESTORE_ACCESS_TOKEN || '').trim();
    if (explicit) return explicit;
    if (cachedToken && cachedTokenExpiresAt > now() + 30_000) return cachedToken;

    serviceAccountPromise ||= readServiceAccount(env);
    const serviceAccount = await serviceAccountPromise;
    if (serviceAccount?.client_email && serviceAccount?.private_key) {
      const assertion = createServiceAccountJwt(serviceAccount, now);
      const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.access_token) {
        throw new FirestoreConfigurationError(
          'Google service-account token exchange failed (HTTP ' + response.status + ').',
          'FIRESTORE_TOKEN_EXCHANGE_FAILED',
        );
      }
      cachedToken = String(payload.access_token);
      cachedTokenExpiresAt = now() + Math.min(Number(payload.expires_in || 3600) * 1000, tokenTtlMs);
      return cachedToken;
    }

    if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
      try {
        const response = await fetchImpl(
          'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
          { headers: { 'Metadata-Flavor': 'Google' } },
        );
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.access_token) {
          cachedToken = String(payload.access_token);
          cachedTokenExpiresAt = now() + Math.min(Number(payload.expires_in || 3600) * 1000, tokenTtlMs);
          return cachedToken;
        }
      } catch {
        // Fall through to the actionable configuration error below.
      }
    }

    throw new FirestoreConfigurationError(
      'Firestore credentials are missing. Set SHRINEFLOW_FIRESTORE_ACCESS_TOKEN for local use, or configure Google Application Default Credentials.',
      'FIRESTORE_CREDENTIALS_REQUIRED',
    );
  }

  async function request(path, options = {}) {
    const token = await resolveAccessToken();
    const response = await fetchImpl(root + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || 'Firestore request failed (HTTP ' + response.status + ').');
      error.status = response.status;
      error.code = payload.error?.status || payload.error?.code || 'FIRESTORE_REQUEST_FAILED';
      error.details = payload.error || payload;
      throw error;
    }
    return payload;
  }

  function collectionPath(collection) {
    const name = String(collection || '').trim();
    if (!name || name.includes('/') || name === '.' || name === '..') throw new Error('Firestore collection name is invalid.');
    return '/' + encodeURIComponent(name);
  }

  async function listDocuments(collection, { transaction = '' } = {}) {
    const documents = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ pageSize: '300', orderBy: '__name__' });
      if (pageToken) params.set('pageToken', pageToken);
      if (transaction) params.set('transaction', transaction);
      const payload = await request(collectionPath(collection) + '?' + params);
      documents.push(...(payload.documents || []));
      pageToken = String(payload.nextPageToken || '');
    } while (pageToken);
    return documents;
  }

  function structuredWhere(filters = {}) {
    const clauses = Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .map(([fieldPath, value]) => ({
        fieldFilter: {
          field: { fieldPath },
          op: 'EQUAL',
          value: encodeFirestoreValue(value),
        },
      }));
    if (!clauses.length) return undefined;
    if (clauses.length === 1) return clauses[0];
    return { compositeFilter: { op: 'AND', filters: clauses } };
  }

  async function runQuery(collection, {
    filters = {},
    orderBy = '',
    direction = 'asc',
    limit = 0,
    transaction = '',
  } = {}) {
    const structuredQuery = { from: [{ collectionId: String(collection) }] };
    const where = structuredWhere(filters);
    if (where) structuredQuery.where = where;
    if (orderBy) {
      structuredQuery.orderBy = [{
        field: { fieldPath: String(orderBy) },
        direction: String(direction).toLowerCase() === 'desc' ? 'DESCENDING' : 'ASCENDING',
      }];
    }
    if (Number(limit) > 0) structuredQuery.limit = Math.floor(Number(limit));
    const payload = await request(':runQuery', {
      method: 'POST',
      body: JSON.stringify({ structuredQuery, ...(transaction ? { transaction } : {}) }),
    });
    return (Array.isArray(payload) ? payload : []).map((entry) => entry.document).filter(Boolean);
  }

  async function beginTransaction() {
    const payload = await request(':beginTransaction', {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    return payload.transaction;
  }

  async function commit(writes, transaction = '') {
    return request(':commit', {
      method: 'POST',
      body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }),
    });
  }

  function documentPath(collection, id) {
    return collectionPath(collection) + '/' + encodeURIComponent(String(id));
  }

  return Object.freeze({
    backend: 'firestore',
    projectId: normalizedProjectId,
    databaseId: normalizedDatabaseId,
    encodeFirestoreDocument,
    decodeFirestoreDocument,
    documentIdFromName,
    listDocuments,
    runQuery,
    beginTransaction,
    commit,
    documentPath,
    async getDocument(collection, id, { transaction = '' } = {}) {
      const query = transaction ? '?transaction=' + encodeURIComponent(transaction) : '';
      try {
        return await request(documentPath(collection, id) + query);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
  });
}

export function firestoreWriteForDocument(document, currentDocument = undefined) {
  return { update: document, ...(currentDocument ? { currentDocument } : {}) };
}

export function firestoreDeleteForDocument(name) {
  return { delete: name };
}

export function firestoreDocumentName(client, collection, id) {
  return 'projects/' + client.projectId
    + '/databases/' + client.databaseId
    + '/documents' + client.documentPath(collection, id);
}
