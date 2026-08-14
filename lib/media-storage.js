import path from 'node:path';

import { directories } from './store.js';

function safeUploadName(mediaPath) {
  const value = String(mediaPath || '').trim();
  if (!value.startsWith('/uploads/')) return '';
  const name = path.basename(value);
  return name && name !== '.' && name !== '..' ? name : '';
}

export function createLocalMediaStorage({ uploadsDirectory = directories.uploads } = {}) {
  return Object.freeze({
    backend: 'local-filesystem',
    resolveFilePath(mediaPath) {
      const name = safeUploadName(mediaPath);
      return name ? path.join(uploadsDirectory, name) : null;
    },
    resolveWebPath(fileName) {
      const name = path.basename(String(fileName || '').trim());
      return name && name !== '.' && name !== '..' ? `/uploads/${name}` : null;
    },
    resolvePublicUrl(mediaPath, baseUrl = process.env.PUBLIC_MEDIA_BASE_URL) {
      const webPath = String(mediaPath || '').trim();
      const base = String(baseUrl || '').trim().replace(/\/$/, '');
      if (!base || !safeUploadName(webPath)) return null;
      return `${base}${webPath}`;
    },
  });
}

let defaultMediaStorage;

export function getMediaStorage() {
  if (!defaultMediaStorage) {
    const backend = String(process.env.SHRINEFLOW_MEDIA_BACKEND || 'local-filesystem').trim().toLowerCase();
    if (backend !== 'local-filesystem') {
      const error = new Error(`???????????${backend}???????? local-filesystem?`);
      error.code = 'MEDIA_BACKEND_UNAVAILABLE';
      throw error;
    }
    defaultMediaStorage = createLocalMediaStorage();
  }
  return defaultMediaStorage;
}

export function resetMediaStorageForTests() {
  defaultMediaStorage = undefined;
}
