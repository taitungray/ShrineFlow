export function previewMediaSrc(path = '') {
  const source = String(path || '').trim();
  if (!source) return '';
  if (/^(blob:|data:|https?:\/\/)/i.test(source)) return source;
  let normalized = source;
  if (!normalized.startsWith('/')) {
    normalized = '/uploads/' + normalized.replace(/^uploads\//i, '');
  }
  if (normalized.startsWith('/uploads/') || normalized.startsWith('/media/')) {
    return '/api/media/preview?path=' + encodeURIComponent(normalized);
  }
  return normalized;
}
