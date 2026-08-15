const REAUTH_STORAGE_KEY = 'shrineflow.reauthToken';

let reauthHandler = null;

export function setReauthHandler(handler) {
  reauthHandler = handler;
}

function requestHeaders(options = {}) {
  const headers = new Headers(options.headers || {});
  const reauthToken = sessionStorage.getItem(REAUTH_STORAGE_KEY);
  if (reauthToken && !headers.has('X-Reauth-Token')) headers.set('X-Reauth-Token', reauthToken);
  return headers;
}

export function storeReauthToken(token) {
  if (token) sessionStorage.setItem(REAUTH_STORAGE_KEY, token);
  else sessionStorage.removeItem(REAUTH_STORAGE_KEY);
}

export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: requestHeaders(options) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.code === 'REAUTH_REQUIRED' && !options._reauthRetry && typeof reauthHandler === 'function') {
    await reauthHandler();
    return api(path, { ...options, _reauthRetry: true });
  }
  if (!response.ok) {
    if (response.status === 401 && data.code !== 'REAUTH_REQUIRED' && !String(path).includes('/api/auth/')) {
      window.location.reload();
    }
    const error = new Error(data.error || '請求失敗');
    error.status = response.status;
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return data;
}
