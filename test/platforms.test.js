import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishingState, getPublishingPlatforms } from '../lib/platforms.js';

test('exposes facebook, instagram, threads without line', () => {
  const platforms = getPublishingPlatforms(false);
  assert.deepEqual(platforms.map((p) => p.id), ['facebook', 'instagram', 'threads']);
  assert.ok(!platforms.some((p) => p.id === 'line'));
});

test('keeps boolean argument compatibility for Facebook configuration', () => {
  const platforms = getPublishingPlatforms(true);
  assert.equal(platforms[0].configured, true);
  assert.equal(platforms[1].configured, false);
  assert.equal(platforms[2].configured, false);
});

test('enables configured Instagram and Threads content types', () => {
  const platforms = getPublishingPlatforms({
    facebookConfigured: true,
    instagramConfigured: true,
    threadsConfigured: true,
  });

  assert.deepEqual(platforms.map((platform) => platform.enabled), [true, true, true]);
  assert.deepEqual(platforms.map((platform) => platform.configured), [true, true, true]);
  assert.ok(platforms[1].contentTypes.every((contentType) => contentType.canPublish));
  assert.ok(platforms[2].contentTypes.every((contentType) => contentType.canPublish));
});

test('disables unconfigured publishing platforms', () => {
  const platforms = getPublishingPlatforms(false);
  assert.deepEqual(platforms.map((platform) => platform.id), ['facebook', 'instagram', 'threads']);
  assert.deepEqual(platforms.map((platform) => platform.enabled), [false, false, false]);
  assert.deepEqual(platforms[0].contentTypes.map((contentType) => contentType.id), ['post', 'reel', 'story']);
  assert.equal(platforms[0].contentTypes[0].canPublish, true);
  assert.equal(platforms[0].contentTypes[1].canPublish, true);
  assert.equal(platforms[0].contentTypes[2].canPublish, true);
});

test('builds fresh publishing state from saved client credentials', () => {
  const state = buildPublishingState({
    facebookConfigured: false,
    facebookPageId: '',
    clients: [{
      accounts: [
        {
          platformId: 'instagram',
          credentials: { userId: 'ig-123', accessToken: 'ig-token' },
        },
        {
          platformId: 'threads',
          credentials: { userId: 'threads-456', accessToken: 'threads-token' },
        },
      ],
    }],
  });

  assert.deepEqual(state.platforms.map((platform) => platform.configured), [false, true, true]);
  assert.deepEqual(state.accounts.map((account) => account.configured), [false, true, true]);
});
