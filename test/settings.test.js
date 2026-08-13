import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvContent, formatEnvContent, maskKey } from '../lib/settings.js';

test('parseEnvContent correctly parses env key-values', () => {
  const raw = `
# Comment line
GEMINI_API_KEY=test_key_12345
GEMINI_MODEL="gemini-3.6-flash"
FACEBOOK_PAGE_ID='1000222'
  `;
  const env = parseEnvContent(raw);
  assert.equal(env.GEMINI_API_KEY, 'test_key_12345');
  assert.equal(env.GEMINI_MODEL, 'gemini-3.6-flash');
  assert.equal(env.FACEBOOK_PAGE_ID, '1000222');
});

test('maskKey correctly masks sensitive key strings', () => {
  assert.equal(maskKey(''), '');
  assert.equal(maskKey('12345678'), '****');
  assert.equal(maskKey('AIzaSyABC123456XYZ999'), 'AIza...Z999');
});

test('formatEnvContent builds valid env file content', () => {
  const env = {
    GEMINI_API_KEY: 'test_key',
    GEMINI_MODEL: 'gemini-3.6-flash',
    PUBLIC_MEDIA_BASE_URL: 'https://media.example',
  };
  const formatted = formatEnvContent(env);
  assert.match(formatted, /GEMINI_API_KEY=test_key/);
  assert.match(formatted, /GEMINI_MODEL=gemini-3.6-flash/);
  assert.match(formatted, /PUBLIC_MEDIA_BASE_URL=https:\/\/media\.example/);
});
