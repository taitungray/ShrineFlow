import { $ } from './dom.js';
import { currentClient, state } from './state.js';

export function facebookStatusLabel() {
  const client = currentClient();
  const facebookAccount = (client?.accounts || []).find(
    (account) => account.platformId === 'facebook' && account.configured
  );
  const facebookStatus = state.facebookStatus || {};
  const statusError = String(facebookStatus.error || '');
  if (facebookStatus.connected === false && (facebookStatus.configured || facebookAccount)) {
    if (/expired|過期|validating access token/i.test(statusError)) return 'FB Token 已過期';
    if (statusError) return 'FB 連線失敗';
  }
  if (facebookAccount) return 'FB 已設定';
  if (facebookStatus.connected) return 'FB 全域已連線';
  return 'FB 未設定';
}

export function renderApiStatus() {
  const status = $('#apiStatus');
  if (!status) return;
  const config = state.config || {};
  const facebookStatus = state.facebookStatus || {};
  const client = currentClient();
  const clientLabel = client ? client.name : '未選品牌';
  const aiOk = Boolean(config.aiConfigured);
  const fbLabel = facebookStatusLabel();
  const fbOk = !['FB 未設定', 'FB Token 已過期', 'FB 連線失敗'].includes(fbLabel);
  const compact = window.matchMedia('(max-width: 768px)').matches;
  status.textContent = compact
    ? ((aiOk ? 'AI✓' : 'AI✗') + ' · ' + (fbOk ? 'FB✓' : 'FB✗'))
    : (clientLabel + ' · ' + (aiOk ? (config.provider || 'Gemini') + ' 已連線' : 'Gemini 未連線') + ' · ' + fbLabel);
  status.title = [
    clientLabel,
    aiOk ? ((config.provider || 'Gemini') + ' 已連線') : 'Gemini 未連線',
    fbLabel,
    facebookStatus.error || '',
  ].filter(Boolean).join('\n');
  status.dataset.ready = config.aiConfigured ? 'true' : 'false';
}
