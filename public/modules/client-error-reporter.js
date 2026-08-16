const DEBOUNCE_MS = 10_000;
const recentKeys = new Map();

let started = false;
let originalFetch = null;

export function shouldIgnoreClientErrorUrl(url = '') {
  const value = String(url || '');
  if (!value) return false;
  if (/^chrome-extension:|^moz-extension:/i.test(value)) return true;
  try {
    const parsed = /^https?:\/\//i.test(value) ? new URL(value) : new URL(value, 'http://local.invalid');
    const path = parsed.pathname;
    if (path.endsWith('/system/client-errors')) return true;
    if (path.endsWith('/system/error-log') || path.includes('/system/error-log/')) return true;
  } catch {
    if (value.includes('/system/client-errors') || value.includes('/system/error-log')) return true;
  }
  return false;
}

function debounceKey(payload) {
  return [payload.scope, payload.method, payload.path, payload.status || '', payload.message || ''].join('|');
}

function shouldDebounce(payload) {
  const key = debounceKey(payload);
  const now = Date.now();
  const last = recentKeys.get(key) || 0;
  if (now - last < DEBOUNCE_MS) return true;
  recentKeys.set(key, now);
  return false;
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return String(input);
  return String(input?.url || '');
}

async function postError(payload) {
  if (shouldDebounce(payload)) return;
  const send = originalFetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!send) return;
  try {
    await send('/api/system/client-errors', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Reporting must never replace the original UI or request error.
  }
}

function onWindowError(event) {
  const target = event.target;
  if (target && target !== window) {
    const url = target.currentSrc || target.src || target.href || '';
    if (shouldIgnoreClientErrorUrl(url)) return;
    void postError({
      scope: 'client_resource',
      method: 'GET',
      path: url,
      message: 'Resource failed to load',
    });
    return;
  }
  const message = String(event.message || event.error?.message || 'Unhandled error');
  const path = String(event.filename || '');
  if (shouldIgnoreClientErrorUrl(path)) return;
  void postError({
    scope: 'client_js',
    path,
    code: event.error?.name || '',
    message,
  });
}

function onUnhandledRejection(event) {
  const reason = event.reason;
  const message = String(reason?.message || reason || 'Unhandled rejection');
  void postError({
    scope: 'client_js',
    code: reason?.name || '',
    message,
  });
}

function reportNetwork(input, init, response) {
  if (!response || response.ok) return;
  const url = requestUrl(input);
  if (shouldIgnoreClientErrorUrl(url)) return;
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  void postError({
    scope: 'client_network',
    method,
    path: url,
    status: response.status,
    message: response.statusText || 'Request failed',
  });
}

export function initClientErrorReporter() {
  if (started || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  started = true;
  originalFetch = window.fetch.bind(window);
  window.addEventListener('error', onWindowError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  window.fetch = async function shrineflowFetch(input, init) {
    const response = await originalFetch(input, init);
    reportNetwork(input, init, response);
    return response;
  };
}
