import test from 'node:test';
import assert from 'node:assert/strict';
import { maskClient, buildDefaultClientFromEnv, findAccount } from '../lib/clients.js';

test('maskClient hides pageAccessToken', () => {
  const masked = maskClient({
    id: 'c1',
    name: 'A',
    accounts: [{
      id: 'facebook:1',
      platformId: 'facebook',
      name: 'Page',
      enabled: true,
      configured: true,
      credentials: { pageId: '1', pageAccessToken: 'abcdefghijklmnop' },
    }],
  });
  assert.equal(masked.accounts[0].credentials.pageAccessToken.includes('...'), true);
  assert.equal(masked.accounts[0].credentials.pageId, '1');
  assert.notEqual(masked.accounts[0].credentials.pageAccessToken, 'abcdefghijklmnop');
});

test('buildDefaultClientFromEnv creates facebook account when env set', () => {
  const client = buildDefaultClientFromEnv({
    FACEBOOK_PAGE_ID: '999',
    FACEBOOK_PAGE_ACCESS_TOKEN: 'token-value-here',
  }, () => 'fixed-id');
  assert.equal(client.id, 'fixed-id');
  assert.equal(client.name, '預設客戶');
  assert.equal(client.accounts[0].id, 'facebook:999');
  assert.equal(client.accounts[0].configured, true);
  assert.equal(client.accounts[0].credentials.pageAccessToken, 'token-value-here');
});

test('buildDefaultClientFromEnv returns null without facebook env', () => {
  assert.equal(buildDefaultClientFromEnv({}, () => 'x'), null);
});

test('findAccount matches by id', () => {
  const client = {
    accounts: [{ id: 'facebook:1', platformId: 'facebook' }, { id: 'instagram:default', platformId: 'instagram' }],
  };
  assert.equal(findAccount(client, 'instagram:default').platformId, 'instagram');
  assert.equal(findAccount(client, 'missing'), null);
});
