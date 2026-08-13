import test from 'node:test';
import assert from 'node:assert/strict';
import { findPlatformAccount, getPlatformAccounts } from '../lib/platform-accounts.js';

test('keeps account identity separate from platform identity', () => {
  const accounts = getPlatformAccounts({ facebookPageId: '123', facebookConfigured: true });
  const facebook = findPlatformAccount(accounts, 'facebook:123');
  assert.equal(facebook.platformId, 'facebook');
  assert.equal(facebook.configured, true);
  assert.equal(findPlatformAccount(accounts, 'instagram:default').platformId, 'instagram');
  assert.ok(!accounts.some((account) => account.id === 'line:default'));
});

test('enables configured Instagram and Threads fallback accounts', () => {
  const accounts = getPlatformAccounts({
    instagramConfigured: true,
    threadsConfigured: true,
  });

  const instagram = findPlatformAccount(accounts, 'instagram:default');
  const threads = findPlatformAccount(accounts, 'threads:default');
  assert.equal(instagram.configured, true);
  assert.equal(instagram.enabled, true);
  assert.equal(threads.configured, true);
  assert.equal(threads.enabled, true);
});
