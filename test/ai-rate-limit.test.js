import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiRateLimiter } from '../lib/ai-rate-limit.js';

test('AI rate limiter blocks a burst from the same actor and allows another actor', () => {
  let current = 1_000;
  const limiter = createAiRateLimiter({
    maxRequests: 2,
    windowMs: 60_000,
    now: () => current,
  });
  limiter.assertAllowed('editor-a');
  limiter.assertAllowed('editor-a');
  assert.throws(
    () => limiter.assertAllowed('editor-a'),
    (error) => error.status === 429 && error.code === 'AI_RATE_LIMITED',
  );
  limiter.assertAllowed('editor-b');
  current += 60_001;
  limiter.assertAllowed('editor-a');
});
