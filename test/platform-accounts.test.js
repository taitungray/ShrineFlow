import test from 'node:test';
import assert from 'node:assert/strict';
import { findPlatformAccount, getPlatformAccounts } from '../lib/platform-accounts.js';

test('keeps account identity separate from platform identity', () => {
  const accounts = getPlatformAccounts({ facebookPageId: '123', facebookConfigured: true });
  const facebook = findPlatformAccount(accounts, 'facebook:123');
  assert.equal(facebook.platformId, 'facebook');
  assert.equal(facebook.configured, true);
  assert.equal(findPlatformAccount(accounts, 'instagram:default').platformId, 'instagram');
});
