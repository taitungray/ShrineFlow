export const MAX_MEDIA_ITEMS = 10;

function trim(value) {
  return String(value || '').trim();
}

function isVideoMedia(value = '', mimeType = '') {
  return String(mimeType).startsWith('video/')
    || /\.(mp4|m4v|mov|mpeg|mpg|webm|ogv|avi)(?:[?#]|$)/i.test(String(value));
}

function mediaName(path, fallback = '') {
  const cleanPath = String(path || '').split(/[?#]/)[0];
  const name = cleanPath.split('/').pop() || fallback || '未命名素材';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function assetTimestamp(asset = {}) {
  return Date.parse(asset.createdAt || asset.updatedAt || 0) || 0;
}

export function isReadyPickerAsset(asset = {}, clientId = '') {
  const path = trim(asset.mediaPath);
  if (!path || asset.status !== 'ready' || asset.deletedAt) return false;
  if (clientId && trim(asset.clientId) !== clientId) return false;
  return true;
}

export function seedSelectedMedia(currentItems = [], existingPaths = []) {
  if (Array.isArray(currentItems) && currentItems.length) return currentItems;
  return (Array.isArray(existingPaths) ? existingPaths : [])
    .map((mediaPath) => String(mediaPath || '').trim())
    .filter(Boolean)
    .map((mediaPath) => mediaItemFromAsset({ mediaPath }));
}

export function mediaItemFromAsset(asset = {}) {
  const mediaPath = trim(asset.mediaPath);
  const mimeType = trim(asset.mimeType);
  return {
    kind: 'library',
    mediaId: trim(asset.id),
    serverPath: mediaPath,
    source: mediaPath,
    type: mimeType || (isVideoMedia(mediaPath) ? 'video' : 'image'),
    name: trim(asset.originalName) || mediaName(mediaPath),
  };
}

export function collectPickerAssets({ assets = [], posts = [], clientId = '' } = {}) {
  const byPath = new Map();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    if (!isReadyPickerAsset(asset, clientId)) return;
    const current = byPath.get(asset.mediaPath);
    if (!current || assetTimestamp(asset) >= assetTimestamp(current)) byPath.set(asset.mediaPath, { ...asset });
  });
  (Array.isArray(posts) ? posts : []).forEach((post) => {
    if (clientId && post.clientId && trim(post.clientId) !== clientId) return;
    const paths = Array.isArray(post.mediaPaths) && post.mediaPaths.length
      ? post.mediaPaths
      : (post.imagePath ? [post.imagePath] : []);
    paths.forEach((mediaPath) => {
      const path = trim(mediaPath);
      if (!path || byPath.has(path)) return;
      byPath.set(path, {
        id: '',
        clientId: trim(post.clientId) || clientId,
        mediaPath: path,
        originalName: mediaName(path),
        mimeType: isVideoMedia(path) ? 'video/mp4' : 'image/jpeg',
        status: 'ready',
        createdAt: post.updatedAt || post.createdAt || '',
      });
    });
  });
  return [...byPath.values()].sort((left, right) => assetTimestamp(right) - assetTimestamp(left));
}

export function filterPickerAssets(items = [], { query = '', type = 'all' } = {}) {
  const needle = trim(query).toLowerCase();
  return items.filter((item) => {
    const video = isVideoMedia(item.mediaPath, item.mimeType);
    if (type === 'video' && !video) return false;
    if (type === 'image' && video) return false;
    if (!needle) return true;
    const haystack = [item.originalName, item.mediaPath, item.id, mediaName(item.mediaPath)].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

export function assetsInSelectionOrder(assets = [], selectedPaths = []) {
  const byPath = new Map();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    const path = trim(asset.mediaPath);
    if (path) byPath.set(path, asset);
  });
  return (Array.isArray(selectedPaths) ? selectedPaths : [])
    .map((path) => byPath.get(trim(path)))
    .filter(Boolean);
}

export function selectedMediaKey(item = {}) {
  if (item.serverPath) return 'path:' + item.serverPath;
  if (item.mediaId) return 'id:' + item.mediaId;
  if (item.file) return 'file:' + (item.file.name || '') + ':' + (item.file.size || 0);
  return '';
}

export function mergeSelectedMedia(currentItems = [], incomingItems = [], { max = MAX_MEDIA_ITEMS } = {}) {
  const items = [...currentItems];
  const seen = new Set(items.map(selectedMediaKey).filter(Boolean));
  let skippedDuplicate = 0;
  let skippedLimit = 0;
  incomingItems.forEach((item) => {
    const key = selectedMediaKey(item);
    if (key && seen.has(key)) {
      skippedDuplicate += 1;
      return;
    }
    if (items.length >= max) {
      skippedLimit += 1;
      return;
    }
    if (key) seen.add(key);
    items.push(item);
  });
  return { items, skippedDuplicate, skippedLimit, added: items.length - currentItems.length };
}

export function findReadyAssetByChecksum(assets = [], checksum = '', clientId = '') {
  const digest = trim(checksum).toLowerCase();
  if (!digest) return null;
  return (Array.isArray(assets) ? assets : []).find((asset) => (
    isReadyPickerAsset(asset, clientId)
    && trim(asset.checksumSha256).toLowerCase() === digest
  )) || null;
}

export function bindPersistedMediaItems(items = [], paths = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const serverPath = trim(paths[index] || item.serverPath);
    if (!serverPath) return item;
    return {
      ...item,
      kind: 'library',
      serverPath,
      source: serverPath,
      file: null,
      mediaId: trim(item.mediaId),
    };
  });
}

export function annotateMediaDuplicates(items = [], assets = []) {
  const checksumByPath = new Map();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    const mediaPath = trim(asset?.mediaPath);
    const digest = trim(asset?.checksumSha256).toLowerCase();
    if (mediaPath && digest) checksumByPath.set(mediaPath, digest);
  });
  const counts = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const digest = checksumByPath.get(item.path) || '';
    if (!digest) return;
    counts.set(digest, (counts.get(digest) || 0) + 1);
  });
  return (Array.isArray(items) ? items : []).map((item) => {
    const checksumSha256 = checksumByPath.get(item.path) || '';
    return {
      ...item,
      checksumSha256,
      duplicateCount: checksumSha256 ? (counts.get(checksumSha256) || 1) : 1,
    };
  });
}

export function buildGenerateMediaPayload(items = []) {
  const files = [];
  const sequence = items.map((item) => {
    const serverPath = trim(item.serverPath);
    if (serverPath) {
      return {
        kind: 'library',
        mediaPath: serverPath,
        mediaId: trim(item.mediaId),
      };
    }
    if (item.file) {
      const index = files.length;
      files.push(item.file);
      return { kind: 'upload', index };
    }
    return {
      kind: 'library',
      mediaPath: trim(item.source),
      mediaId: trim(item.mediaId),
    };
  });
  return { files, sequence };
}

export function pickerSelectionMessage({ added = 0, skippedDuplicate = 0, skippedLimit = 0 } = {}) {
  if (!added && skippedLimit) return '已達 10 個上限，沒有加入新素材。';
  if (!added && skippedDuplicate) return '所選素材已在清單中。';
  if (!added) return '請先勾選要加入的素材。';
  const parts = ['已從素材庫加入 ' + added + ' 個檔案'];
  if (skippedDuplicate) parts.push('略過重複 ' + skippedDuplicate + ' 個');
  if (skippedLimit) parts.push('超過上限未加入 ' + skippedLimit + ' 個');
  return parts.join('；') + '。';
}
