import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORM_RATE_LIMIT_POLICY,
  ProviderRateLimitError,
  createRateLimitedFetch,
  resetProviderRateLimitBuckets,
} from '../lib/platform-rate-limit.js';

test.afterEach(() => resetProviderRateLimitBuckets());

test('provider rate limiter spaces requests and shares a bounded platform bucket', async () => {
  const startedAt = [];
  const fetchImpl = async () => {
    startedAt.push(Date.now());
    return new Response('{}', { status: 200 });
  };
  const guardedFetch = createRateLimitedFetch(fetchImpl, { platformId: 'threads', accountKey: 'threads:1' });

  await Promise.all([
    guardedFetch('https://example.test/1'),
    guardedFetch('https://example.test/2'),
    guardedFetch('https://example.test/3'),
  ]);

  assert.equal(startedAt.length, 3);
  assert.ok(startedAt[1] - startedAt[0] >= PLATFORM_RATE_LIMIT_POLICY.minIntervalMs - 10);
  assert.ok(startedAt[2] - startedAt[1] >= PLATFORM_RATE_LIMIT_POLICY.minIntervalMs - 10);
});

test('provider rate limiter rejects an overflowing queue instead of growing indefinitely', async () => {
  let release;
  const firstRequest = new Promise((resolve) => { release = resolve; });
  const fetchImpl = () => firstRequest.then(() => new Response('{}', { status: 200 }));
  const guardedFetch = createRateLimitedFetch(fetchImpl, { platformId: 'facebook', accountKey: 'page:1' });

  const requests = [guardedFetch('https://example.test/0')];
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (let index = 1; index <= PLATFORM_RATE_LIMIT_POLICY.maxQueueSize; index += 1) {
    requests.push(guardedFetch(`https://example.test/${index}`));
  }
  await assert.rejects(
    () => guardedFetch('https://example.test/overflow'),
    (error) => error instanceof ProviderRateLimitError && error.status === 429 && error.retriable,
  );
  release();
  await Promise.all(requests);
});
