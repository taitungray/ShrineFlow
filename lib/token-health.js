const TOKEN_WARNING_DAYS = 14;

function parseExpiry(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getTokenHealth(account, now = Date.now()) {
  const expiryTimestamp = parseExpiry(account?.tokenExpiresAt);
  let status = 'unknown';
  let expiresInDays = null;

  if (expiryTimestamp !== null) {
    expiresInDays = Math.ceil((expiryTimestamp - now) / (24 * 60 * 60 * 1000));
    if (expiresInDays < 0) status = 'expired';
    else if (expiresInDays <= TOKEN_WARNING_DAYS) status = 'expiring';
    else status = 'valid';
  } else if (!account?.configured) {
    status = 'not_configured';
  }

  return {
    status,
    expiresAt: expiryTimestamp === null ? null : new Date(expiryTimestamp).toISOString(),
    expiresInDays,
    expirySource: expiryTimestamp === null ? 'not_available' : 'operator_input',
    connectionStatus: account?.health?.status || (account?.configured ? 'unverified' : 'not_configured'),
    lastCheckedAt: account?.health?.lastCheckedAt || null,
    lastSuccessAt: account?.health?.lastSuccessAt || null,
    lastErrorAt: account?.health?.lastErrorAt || null,
    lastError: account?.health?.lastError || null,
  };
}

export function accountHealthMessage(tokenHealth) {
  if (tokenHealth.status === 'expired') return 'Token 已過期';
  if (tokenHealth.status === 'expiring') return `Token 將於 ${tokenHealth.expiresInDays} 天內到期`;
  if (tokenHealth.status === 'valid') return `Token 有效，剩餘 ${tokenHealth.expiresInDays} 天`;
  if (tokenHealth.status === 'not_configured') return '尚未設定 Token';
  return '到期日未填（可留白）';
}

export const TOKEN_WARNING_WINDOW_DAYS = TOKEN_WARNING_DAYS;
