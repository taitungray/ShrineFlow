import { state } from './state.js';

export function previewMediaSrc(path = '') {
  const source = String(path || '').trim();
  if (!source) return '';
  if (/^(blob:|data:|https?:\/\/)/i.test(source)) return source;
  const base = String(state.config?.publicMediaBaseUrl || '').replace(/\/$/, '');
  let normalized = source;
  if (!normalized.startsWith('/')) {
    normalized = '/uploads/' + normalized.replace(/^uploads\//i, '');
  }
  if (base && (normalized.startsWith('/uploads/') || normalized.startsWith('/media/'))) {
    return base + normalized;
  }
  return normalized;
}
