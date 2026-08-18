import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSINESS_SUITE_ANDROID_PACKAGE,
  BUSINESS_SUITE_IOS_SCHEME,
  businessSuiteAppUrl,
  businessSuiteWebUrl,
  isMobileUserAgent,
  openBusinessSuiteUrl,
} from '../public/modules/business-suite-links.js';

test('businessSuiteWebUrl builds official latest paths and optional asset_id', () => {
  assert.equal(businessSuiteWebUrl(), 'https://business.facebook.com/latest/home');
  assert.equal(businessSuiteWebUrl({ dest: 'inbox' }), 'https://business.facebook.com/latest/inbox');
  assert.equal(businessSuiteWebUrl({ dest: 'scheduled' }), 'https://business.facebook.com/latest/posts/scheduled_posts');
  assert.equal(
    businessSuiteWebUrl({ dest: 'home', pageId: '100088888888' }),
    'https://business.facebook.com/latest/home?asset_id=100088888888',
  );
});

test('isMobileUserAgent and app URLs prefer native Business Suite', () => {
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
  assert.equal(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
  assert.equal(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14)'), true);

  const webUrl = 'https://business.facebook.com/latest/inbox?asset_id=1';
  assert.equal(businessSuiteAppUrl('iPhone', webUrl), BUSINESS_SUITE_IOS_SCHEME);
  const android = businessSuiteAppUrl('Android', webUrl);
  assert.match(android, new RegExp(`package=${BUSINESS_SUITE_ANDROID_PACKAGE}`));
  assert.match(android, /intent:\/\/business\.facebook\.com\/latest\/inbox\?asset_id=1/);
  assert.match(android, /S\.browser_fallback_url=/);
});

test('openBusinessSuiteUrl opens web on desktop and app on mobile', () => {
  const opened = [];
  const desktop = {
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    window: { open(url, target, features) { opened.push({ url, target, features }); } },
  };
  const result = openBusinessSuiteUrl({ dest: 'home', pageId: '9', userAgent: desktop.navigator.userAgent }, desktop);
  assert.equal(result.opened, 'web');
  assert.equal(opened[0].url, 'https://business.facebook.com/latest/home?asset_id=9');
  assert.equal(opened[0].target, '_blank');

  const mobile = { location: { href: '' } };
  const app = openBusinessSuiteUrl({ dest: 'inbox', pageId: '9', userAgent: 'Android' }, mobile);
  assert.equal(app.opened, 'app');
  assert.match(mobile.location.href, /intent:\/\//);
});
