export function humanizePlatformError(message = '') {
  const text = String(message || '').trim();
  if (!text) return '';
  if (/session has expired|expired access token|error validating access token|invalid oauth/i.test(text) || /\bcode['"]?\s*[:=]\s*190\b/i.test(text)) {
    return 'Facebook Token 已過期。請到「設定 → Facebook」貼上粉專 Page token（me/accounts 的 access_token；Debugger 顯示 Never）。不要用短效 User token。';
  }
  if (/unsupported post request|does not exist, cannot be loaded due to missing permissions|does not support this operation/i.test(text)) {
    return 'Facebook 無法對這個 ID 發文。通常是貼了個人 User ID 或 User token，不是粉專 ID／Page token。請到設定用 Graph Explorer GET me/accounts，貼左邊 JSON 的 id 與 access_token。';
  }
  if (text === 'remote_schedule_unavailable' || /remote_schedule_unavailable/i.test(text)) {
    return '無法讀取 Facebook 遠端排程。請先更新粉專 Token 後再試。';
  }
  return text;
}
