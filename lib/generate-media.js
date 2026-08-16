import fs from 'node:fs/promises';

function trim(value) {
  return String(value || '').trim();
}

function guessMimeType(mediaPath = '', mimeType = '') {
  if (trim(mimeType)) return trim(mimeType);
  return /\.(mp4|m4v|mov|mpeg|mpg|webm|ogv|avi)(?:[?#]|$)/i.test(mediaPath)
    ? 'video/mp4'
    : 'image/jpeg';
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  const text = trim(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return text.split('|').map((item) => trim(item)).filter(Boolean);
  }
}

export function parseMediaSequence(value) {
  if (Array.isArray(value)) return value;
  const text = trim(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readyAssetMap(assets = [], clientId = '') {
  const byPath = new Map();
  const byId = new Map();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    if (!asset || asset.status !== 'ready' || asset.deletedAt || !trim(asset.mediaPath)) return;
    if (clientId && trim(asset.clientId) !== clientId) return;
    byPath.set(trim(asset.mediaPath), asset);
    if (asset.id) byId.set(trim(asset.id), asset);
  });
  return { byPath, byId };
}

function libraryError(message, code = 'MEDIA_REFERENCE_NOT_FOUND') {
  return { code, message };
}

function resolveLibraryRef(entry = {}, maps) {
  const mediaId = trim(entry.mediaId);
  const mediaPath = trim(entry.mediaPath);
  const asset = (mediaId && maps.byId.get(mediaId)) || (mediaPath && maps.byPath.get(mediaPath)) || null;
  if (!asset) return { error: libraryError(`找不到可綁定的素材：${mediaId || mediaPath || '未知'}。`) };
  return {
    item: {
      source: 'library',
      mediaPath: asset.mediaPath,
      mediaId: asset.id || '',
      mimeType: asset.mimeType || '',
      originalName: asset.originalName || '',
    },
  };
}

export function assembleGenerateMedia({
  uploaded = [],
  sequence = [],
  existingMediaPaths = [],
  mediaIds = [],
  assets = [],
  clientId = '',
} = {}) {
  const maps = readyAssetMap(assets, clientId);
  const errors = [];
  const items = [];
  const seen = new Set();

  const pushItem = (item) => {
    const path = trim(item?.mediaPath);
    if (!path || seen.has(path)) return;
    seen.add(path);
    items.push(item);
  };

  const parsedSequence = parseMediaSequence(sequence);
  if (parsedSequence.length) {
    parsedSequence.forEach((entry) => {
      const kind = trim(entry?.kind);
      if (kind === 'upload') {
        const index = Number(entry.index);
        const file = uploaded[index];
        if (!file?.mediaPath && !file?.filename) {
          errors.push(libraryError(`找不到對應的上傳檔案（index ${index}）。`, 'MEDIA_UPLOAD_INDEX_INVALID'));
          return;
        }
        pushItem({
          source: 'upload',
          mediaPath: file.mediaPath || ('/uploads/' + file.filename),
          mediaId: file.mediaId || '',
          mimeType: file.mimetype || file.mimeType || '',
          originalName: file.originalname || file.originalName || '',
          file,
        });
        return;
      }
      if (kind === 'library') {
        const resolved = resolveLibraryRef(entry, maps);
        if (resolved.error) errors.push(resolved.error);
        else pushItem(resolved.item);
      }
    });
    return { items, mediaPaths: items.map((item) => item.mediaPath), errors };
  }

  parseJsonList(existingMediaPaths).forEach((mediaPath) => {
    const resolved = resolveLibraryRef({ mediaPath }, maps);
    if (resolved.error) errors.push(resolved.error);
    else pushItem(resolved.item);
  });
  parseJsonList(mediaIds).forEach((mediaId) => {
    const resolved = resolveLibraryRef({ mediaId }, maps);
    if (resolved.error) errors.push(resolved.error);
    else pushItem(resolved.item);
  });
  uploaded.forEach((file) => {
    const mediaPath = file.mediaPath || (file.filename ? '/uploads/' + file.filename : '');
    if (!mediaPath) return;
    pushItem({
      source: 'upload',
      mediaPath,
      mediaId: file.mediaId || '',
      mimeType: file.mimetype || file.mimeType || '',
      originalName: file.originalname || file.originalName || '',
      file,
    });
  });
  return { items, mediaPaths: items.map((item) => item.mediaPath), errors };
}

export async function hydrateGenerateFiles(items = [], {
  mediaStorage,
  readFile = fs.readFile,
} = {}) {
  const files = [];
  for (const item of items) {
    if (item.file && (item.file.buffer || item.file.path)) {
      files.push(item.file);
      continue;
    }
    const mediaPath = trim(item?.mediaPath);
    if (!mediaPath) continue;
    try {
      if (mediaStorage?.backend === 'r2' && typeof mediaStorage.getBuffer === 'function') {
        const buffer = await mediaStorage.getBuffer(mediaPath);
        files.push({
          buffer,
          mimetype: guessMimeType(mediaPath, item.mimeType),
          originalname: item.originalName || '',
          mediaPath,
        });
        continue;
      }
      const filePath = mediaStorage?.resolveFilePath?.(mediaPath);
      if (!filePath) continue;
      const buffer = await readFile(filePath);
      files.push({
        buffer,
        path: filePath,
        mimetype: guessMimeType(mediaPath, item.mimeType),
        originalname: item.originalName || '',
        mediaPath,
      });
    } catch {
      // Keep the bound path even if AI cannot inline the file.
    }
  }
  return files;
}
