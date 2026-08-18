import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGeminiError, generateWithFallback } from '../lib/gemini-retry.js';

test('retries transient Gemini errors with exponential delays', async () => {
  const delays = [];
  let calls = 0;
  const result = await generateWithFallback({
    models: ['primary'],
    maxAttempts: 3,
    baseDelayMs: 10,
    sleep: async (delay) => delays.push(delay),
    generate: async () => {
      calls += 1;
      if (calls < 3) throw new Error(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }));
      return { text: 'ok' };
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.deepEqual(result, { model: 'primary', result: { text: 'ok' } });
});

test('switches to a fallback model after the primary is unavailable', async () => {
  const calls = [];
  const result = await generateWithFallback({
    models: ['primary', 'fallback'],
    maxAttempts: 1,
    sleep: async () => {},
    generate: async (model) => {
      calls.push(model);
      if (model === 'primary') throw new Error('503 UNAVAILABLE high demand');
      return { text: 'fallback ok' };
    },
  });
  assert.deepEqual(calls, ['primary', 'fallback']);
  assert.equal(result.model, 'fallback');
});

test('turns transient failures into a user-friendly message', () => {
  const message = describeGeminiError(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), ['primary']);
  assert.match(message, /忙碌|暫時無法服務/);
});

test('generateWithFallback times out a hung model call', { timeout: 200 }, async () => {
  await assert.rejects(
    () => generateWithFallback({
      models: ['primary'],
      maxAttempts: 1,
      timeoutMs: 20,
      generate: () => new Promise(() => {}),
    }),
    (error) => {
      assert.equal(error.status, 504);
      assert.match(String(error.message), /timed out|TIMEOUT|逾時/i);
      return true;
    },
  );
});
