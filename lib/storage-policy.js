import path from 'node:path';

const MEGABYTE = 1024 * 1024;

export const COLLECTION_STORAGE_POLICY = Object.freeze({
  gods: Object.freeze({ maxItems: 500 }),
  posts: Object.freeze({ maxItems: 5000 }),
  schedule: Object.freeze({ maxItems: 5000 }),
  clients: Object.freeze({ maxItems: 100, maxAccountsPerClient: 20 }),
  templates: Object.freeze({ maxItems: 500 }),
  campaigns: Object.freeze({ maxItems: 500 }),
  inboxMetadata: Object.freeze({ maxItems: 2400 }),
  notifications: Object.freeze({ maxItems: 200 }),
  errorLog: Object.freeze({ maxItems: 500 }),
});

export const JSON_STORAGE_POLICY = Object.freeze({
  defaultMaxBytes: 64 * MEGABYTE,
  files: Object.freeze({
    gods: Object.freeze({ maxBytes: 2 * MEGABYTE }),
    posts: Object.freeze({ maxBytes: 64 * MEGABYTE }),
    schedule: Object.freeze({ maxBytes: 16 * MEGABYTE }),
    clients: Object.freeze({ maxBytes: 8 * MEGABYTE }),
    templates: Object.freeze({ maxBytes: 8 * MEGABYTE }),
    campaigns: Object.freeze({ maxBytes: 8 * MEGABYTE }),
    inboxMetadata: Object.freeze({ maxBytes: 10 * MEGABYTE }),
    notifications: Object.freeze({ maxBytes: 2 * MEGABYTE }),
    errorLog: Object.freeze({ maxBytes: 4 * MEGABYTE }),
  }),
});

function policyKey(filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  return name.split('.json', 1)[0] || name;
}

export function getJsonStoragePolicy(filePath) {
  const key = policyKey(filePath);
  return {
    key,
    ...JSON_STORAGE_POLICY.files[key],
    maxBytes: JSON_STORAGE_POLICY.files[key]?.maxBytes || JSON_STORAGE_POLICY.defaultMaxBytes,
  };
}

export function getCollectionPolicy(collection) {
  return COLLECTION_STORAGE_POLICY[String(collection || '').trim()] || null;
}

export class StorageLimitError extends Error {
  constructor(message, { code = 'STORAGE_LIMIT_REACHED', details = {} } = {}) {
    super(message);
    this.name = 'StorageLimitError';
    this.code = code;
    this.status = 409;
    this.details = details;
  }
}

export function assertCollectionCapacity(collection, currentCount, additional = 1) {
  const policy = getCollectionPolicy(collection);
  if (!policy?.maxItems) return;
  const current = Math.max(0, Number(currentCount) || 0);
  const requested = Math.max(0, Number(additional) || 0);
  const nextCount = current + requested;
  if (nextCount <= policy.maxItems) return;
  throw new StorageLimitError(
    `${collection} 已達 ${policy.maxItems} 筆上限，請先封存、刪除或匯出既有資料後再新增。`,
    {
      details: {
        collection,
        currentCount: current,
        requestedCount: nextCount,
        maxItems: policy.maxItems,
      },
    },
  );
}

export function assertNestedCollectionCapacity(collection, currentCount, additional = 1) {
  const policy = getCollectionPolicy(collection);
  if (!policy?.maxAccountsPerClient) return;
  const current = Math.max(0, Number(currentCount) || 0);
  const requested = Math.max(0, Number(additional) || 0);
  const nextCount = current + requested;
  if (nextCount <= policy.maxAccountsPerClient) return;
  throw new StorageLimitError(
    `單一品牌最多保存 ${policy.maxAccountsPerClient} 個平台連線。`,
    {
      code: 'STORAGE_NESTED_LIMIT_REACHED',
      details: {
        collection,
        currentCount: current,
        requestedCount: nextCount,
        maxItems: policy.maxAccountsPerClient,
      },
    },
  );
}

export function serializeJsonWithinLimit(filePath, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch (error) {
    throw new StorageLimitError(`JSON 資料無法序列化：${error.message || '資料格式不支援'}。`, {
      code: 'STORAGE_SERIALIZATION_FAILED',
    });
  }
  const bytes = Buffer.byteLength(`${serialized}\n`, 'utf8');
  const policy = getJsonStoragePolicy(filePath);
  if (bytes > policy.maxBytes) {
    throw new StorageLimitError(
      `${policy.key} JSON 已達 ${Math.round(policy.maxBytes / MEGABYTE)} MB 檔案上限，請先封存、刪除或匯出既有資料。`,
      {
        code: 'STORAGE_FILE_LIMIT_REACHED',
        details: { file: policy.key, bytes, maxBytes: policy.maxBytes },
      },
    );
  }
  return { serialized: `${serialized}\n`, bytes, policy };
}

export function countStoredItems(collection, value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  if (collection === 'inboxMetadata') {
    return [value.items, value.cursors, value.syncHints]
      .reduce((total, group) => total + (group && typeof group === 'object' ? Object.keys(group).length : 0), 0);
  }
  return Array.isArray(value.items) ? value.items.length : 0;
}

export const formatStorageBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < MEGABYTE) return `${Math.round(value / 1024)} KB`;
  return `${(value / MEGABYTE).toFixed(1)} MB`;
};
