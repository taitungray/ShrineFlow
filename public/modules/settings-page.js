export const SETTINGS_PAGES = Object.freeze([
  'gemini',
  'brand',
  'facebook',
  'instagram',
  'threads',
  'backup',
]);

export function parseSettingsPage(hash = '') {
  const withoutHash = String(hash || '').replace(/^#\/?/, '');
  const path = withoutHash.split('?')[0].replace(/\/+$/, '') || '';
  if (path !== 'settings' && !path.startsWith('settings/')) return '';
  if (path === 'settings') return 'gemini';
  const page = path.slice('settings/'.length);
  return SETTINGS_PAGES.includes(page) ? page : 'gemini';
}
