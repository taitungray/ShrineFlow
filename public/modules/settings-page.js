export const SETTINGS_PAGES = Object.freeze([
  'gemini',
  'brand',
  'backup',
]);

export const PLATFORMS_PAGES = Object.freeze([
  'overview',
  'facebook',
  'instagram',
  'threads',
]);

export const LEGACY_SETTINGS_PLATFORM_PATHS = Object.freeze({
  'settings/facebook': 'platforms/facebook',
  'settings/instagram': 'platforms/instagram',
  'settings/threads': 'platforms/threads',
});

function hashPath(hash = '') {
  const withoutHash = String(hash || '').replace(/^#\/?/, '');
  return withoutHash.split('?')[0].replace(/\/+$/, '') || '';
}

export function parseSettingsPage(hash = '') {
  const path = hashPath(hash);
  if (path !== 'settings' && !path.startsWith('settings/')) return '';
  if (LEGACY_SETTINGS_PLATFORM_PATHS[path]) return '';
  if (path === 'settings') return 'gemini';
  const page = path.slice('settings/'.length);
  return SETTINGS_PAGES.includes(page) ? page : 'gemini';
}

export function parsePlatformsPage(hash = '') {
  const path = hashPath(hash);
  const legacy = LEGACY_SETTINGS_PLATFORM_PATHS[path];
  const resolved = legacy || path;
  if (resolved !== 'platforms' && !resolved.startsWith('platforms/')) return '';
  if (resolved === 'platforms') return 'overview';
  const page = resolved.slice('platforms/'.length);
  return PLATFORMS_PAGES.includes(page) ? page : 'overview';
}

export function platformsHash(page = 'overview') {
  const active = PLATFORMS_PAGES.includes(page) ? page : 'overview';
  return active === 'overview' ? '#/platforms' : '#/platforms/' + active;
}

export function legacySettingsToPlatformsHash(hash = '') {
  const next = LEGACY_SETTINGS_PLATFORM_PATHS[hashPath(hash)];
  return next ? '#/' + next : '';
}
