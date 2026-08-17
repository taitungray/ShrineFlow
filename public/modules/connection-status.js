export function facebookStatusLabel(client, facebookStatus = {}) {
  const facebookAccount = (client?.accounts || []).find(
    (account) => account.platformId === 'facebook' && account.configured
  );
  const statusError = String(facebookStatus.error || '');
  if (facebookStatus.connected === false && (facebookStatus.configured || facebookAccount)) {
    if (/expired|過期|validating access token/i.test(statusError)) return 'Facebook Token 已過期';
    if (statusError) return 'Facebook 連線失敗';
  }
  if (facebookAccount) return 'Facebook 已設定';
  if (facebookStatus.connected) return 'Facebook 全域已連線';
  return 'Facebook 未設定';
}

const FB_NOT_READY = new Set(['Facebook 未設定', 'Facebook Token 已過期', 'Facebook 連線失敗']);

export function buildConnectionStatus({ client, config = {}, facebookStatus = {} } = {}) {
  const provider = config.provider || 'Gemini';
  const aiReady = Boolean(config.aiConfigured);
  const fbText = facebookStatusLabel(client, facebookStatus);
  return {
    ai: {
      key: 'ai',
      label: provider,
      ready: aiReady,
      text: aiReady ? `${provider} 已連線` : `${provider} 未連線`,
    },
    fb: {
      key: 'fb',
      label: 'Facebook',
      ready: !FB_NOT_READY.has(fbText),
      text: fbText,
    },
  };
}
