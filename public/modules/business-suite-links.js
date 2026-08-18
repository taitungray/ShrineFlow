export const BUSINESS_SUITE_WEB_ORIGIN = 'https://business.facebook.com';
export const BUSINESS_SUITE_ANDROID_PACKAGE = 'com.facebook.pages.app';
export const BUSINESS_SUITE_IOS_SCHEME = 'fb-biz://home';

const DEST_PATHS = Object.freeze({
  home: '/latest/home',
  inbox: '/latest/inbox',
  scheduled: '/latest/posts/scheduled_posts',
});

export function isMobileUserAgent(ua = '') {
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

export function businessSuiteWebUrl({ pageId = '', dest = 'home' } = {}) {
  const path = DEST_PATHS[dest] || DEST_PATHS.home;
  const url = new URL(path, BUSINESS_SUITE_WEB_ORIGIN);
  if (pageId) url.searchParams.set('asset_id', pageId);
  return url.toString();
}

export function businessSuiteAppUrl(ua, webUrl) {
  if (/Android/i.test(ua)) {
    const parsed = new URL(webUrl);
    return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;package=${BUSINESS_SUITE_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return BUSINESS_SUITE_IOS_SCHEME;
  return webUrl;
}

export function openBusinessSuiteUrl(options = {}, env = globalThis) {
  const dest = options.dest || 'home';
  const pageId = options.pageId || '';
  const webUrl = businessSuiteWebUrl({ pageId, dest });
  const ua = options.userAgent || env.navigator?.userAgent || '';

  if (!isMobileUserAgent(ua)) {
    env.window?.open(webUrl, '_blank', 'noopener,noreferrer');
    return { opened: 'web', url: webUrl };
  }

  const appUrl = businessSuiteAppUrl(ua, webUrl);
  if (/Android/i.test(ua)) {
    env.location.href = appUrl;
    return { opened: 'app', url: appUrl, fallback: webUrl };
  }

  const started = Date.now();
  const fallbackMs = Number(options.fallbackMs) || 1400;
  const timer = env.setTimeout?.(() => {
    if (env.document?.visibilityState === 'visible' && Date.now() - started < fallbackMs + 800) {
      env.location.href = webUrl;
    }
  }, fallbackMs);
  env.document?.addEventListener?.('visibilitychange', () => {
    if (env.document.hidden) env.clearTimeout?.(timer);
  }, { once: true });
  env.location.href = appUrl;
  return { opened: 'app', url: appUrl, fallback: webUrl };
}
