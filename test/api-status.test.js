import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConnectionStatus, facebookStatusLabel } from '../public/modules/connection-status.js';

test('connection status omits the brand name from AI and FB chips', () => {
  const view = buildConnectionStatus({
    client: { name: '神秘的神像模型彩繪', accounts: [] },
    config: { aiConfigured: true, provider: 'Gemini' },
    facebookStatus: { connected: false, configured: false, error: '' },
  });

  assert.equal(view.ai.label, 'Gemini');
  assert.equal(view.ai.text, 'Gemini 已連線');
  assert.equal(view.fb.label, 'FB');
  assert.equal(view.fb.text, 'FB 未設定');
  assert.equal(JSON.stringify(view).includes('神秘的神像模型彩繪'), false);
});

test('AI chip is not ready when Gemini is disconnected', () => {
  const view = buildConnectionStatus({
    config: { aiConfigured: false },
    facebookStatus: {},
  });

  assert.equal(view.ai.ready, false);
  assert.equal(view.ai.text, 'Gemini 未連線');
});

test('FB chip is not ready when the token is expired', () => {
  const client = {
    accounts: [{ platformId: 'facebook', configured: true }],
  };
  const facebookStatus = {
    connected: false,
    configured: true,
    error: 'Error validating access token: Session has expired',
  };

  assert.equal(facebookStatusLabel(client, facebookStatus), 'FB Token 已過期');

  const view = buildConnectionStatus({ client, config: { aiConfigured: true }, facebookStatus });
  assert.equal(view.fb.ready, false);
  assert.equal(view.fb.text, 'FB Token 已過期');
  assert.equal(view.ai.ready, true);
});
