const PUBLIC_MEDIA_PREFIXES = ['/uploads/', '/media/'];

export function resolvePublicMediaUrl(webPath, baseUrl = process.env.PUBLIC_MEDIA_BASE_URL) {
  const path = String(webPath || '').trim();
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!base) {
    throw new Error('尚未設定 PUBLIC_MEDIA_BASE_URL。有媒體時請填公網或 tunnel 網址。');
  }
  if (!PUBLIC_MEDIA_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    throw new Error('媒體路徑無效，僅支援 /uploads/ 或 /media/ 下的檔案；請確認 PUBLIC_MEDIA_BASE_URL 與公開網址設定。');
  }
  return `${base}${path}`;
}

export function resolvePublicMediaUrls(webPaths = [], baseUrl) {
  return webPaths.map((p) => resolvePublicMediaUrl(p, baseUrl));
}
