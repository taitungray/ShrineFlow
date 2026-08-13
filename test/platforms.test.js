import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublishingPlatforms } from '../lib/platforms.js';

test('exposes the planned social platforms while only Facebook is publish-enabled', () => {
  const platforms = getPublishingPlatforms(false);
  assert.deepEqual(platforms.map((platform) => platform.id), ['facebook', 'instagram', 'threads', 'line']);
  assert.deepEqual(platforms.map((platform) => platform.enabled), [true, false, false, false]);
  assert.deepEqual(platforms[0].contentTypes.map((contentType) => contentType.id), ['post', 'reel', 'story']);
  assert.equal(platforms[0].contentTypes[0].canPublish, true);
  assert.equal(platforms[0].contentTypes[1].canPublish, true);
  assert.equal(platforms[0].contentTypes[2].canPublish, true);
});
