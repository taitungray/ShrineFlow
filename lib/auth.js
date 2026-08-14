import crypto from 'node:crypto';
import { Router } from 'express';

export const AUTH_POLICY = Object.freeze({
  sessionTtlMs: 12 * 60 * 60 * 1000,
  maxSessions: 4,
  maxLoginAttempts: 5,
  loginLockoutMs: 5 * 60 * 1000,
  maxTrackedClients: 100,
});

export const AUTH_COOKIE_NAME = 'shrineflow_session';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(hash(left));
  const rightBuffer = Buffer.from(hash(right));
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authError(message, status = 401, code = 'AUTH_FAILED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function pruneMap(map, now, predicate) {
  for (const [key, value] of map) {
    if (predicate(value, now)) map.delete(key);
  }
}

export function createAuthService({ env = process.env, now = () => Date.now() } = {}) {
  const operatorPassword = String(env.SHRINEFLOW_OPERATOR_PASSWORD || '').trim();
  const sessionSecret = String(env.SHRINEFLOW_SESSION_SECRET || '').trim();
  const enabled = Boolean(operatorPassword && sessionSecret);
  const sessions = new Map();
  const loginAttempts = new Map();
  const sessionDigest = (token) => crypto.createHmac('sha256', sessionSecret).update(String(token || '')).digest('hex');

  function prune() {
    const current = now();
    pruneMap(sessions, current, (session, timestamp) => session.expiresAt <= timestamp);
    pruneMap(loginAttempts, current, (attempt, timestamp) => (
      attempt.lockedUntil <= timestamp && timestamp - attempt.lastAttemptAt > AUTH_POLICY.loginLockoutMs
    ));
    while (loginAttempts.size > AUTH_POLICY.maxTrackedClients) {
      const oldest = [...loginAttempts.entries()].sort(([, left], [, right]) => left.lastAttemptAt - right.lastAttemptAt)[0];
      if (!oldest) break;
      loginAttempts.delete(oldest[0]);
    }
  }

  function status(rawToken = '') {
    prune();
    if (!enabled) return { enabled: false, authenticated: true };
    const session = sessions.get(sessionDigest(rawToken));
    if (!session || session.expiresAt <= now()) return { enabled: true, authenticated: false };
    return { enabled: true, authenticated: true, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  function login({ password = '', clientKey = 'local' } = {}) {
    prune();
    if (!enabled) return { enabled: false, authenticated: true, token: null };
    const key = String(clientKey || 'local').slice(0, 120);
    const current = now();
    const previous = loginAttempts.get(key) || { count: 0, lastAttemptAt: current, lockedUntil: 0 };
    if (previous.lockedUntil > current) {
      throw authError('登入嘗試過於頻繁，請稍後再試。', 429, 'AUTH_RATE_LIMITED');
    }
    if (!safeEqual(password, operatorPassword)) {
      const count = previous.count + 1;
      loginAttempts.set(key, {
        count,
        lastAttemptAt: current,
        lockedUntil: count >= AUTH_POLICY.maxLoginAttempts ? current + AUTH_POLICY.loginLockoutMs : 0,
      });
      throw authError('登入密碼不正確。');
    }
    loginAttempts.delete(key);
    while (sessions.size >= AUTH_POLICY.maxSessions) {
      const oldest = [...sessions.entries()].sort(([, left], [, right]) => left.createdAt - right.createdAt)[0];
      if (!oldest) break;
      sessions.delete(oldest[0]);
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionDigest(token), { createdAt: current, expiresAt: current + AUTH_POLICY.sessionTtlMs });
    return {
      enabled: true,
      authenticated: true,
      token,
      expiresAt: new Date(current + AUTH_POLICY.sessionTtlMs).toISOString(),
    };
  }

  function authenticate(rawToken = '') {
    const result = status(rawToken);
    return result.authenticated ? result : null;
  }

  function logout(rawToken = '') {
    sessions.delete(sessionDigest(rawToken));
    return { enabled, authenticated: !enabled };
  }

  return {
    enabled,
    status,
    login,
    authenticate,
    logout,
    policy: AUTH_POLICY,
  };
}

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  const match = cookies.map((part) => part.trim().split('='))
    .find(([key]) => key === name);
  return match ? match.slice(1).join('=') : '';
}

function cookieValue(token, secure = false, maxAge = AUTH_POLICY.sessionTtlMs / 1000) {
  return `${AUTH_COOKIE_NAME}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}

export function createAuthRouter({ authService = createAuthService() } = {}) {
  const router = Router();
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  router.get('/auth/status', (request, response) => {
    response.json(authService.status(readCookie(request, AUTH_COOKIE_NAME)));
  });

  router.post('/auth/login', (request, response) => {
    try {
      const result = authService.login({
        password: request.body?.password,
        clientKey: request.ip,
      });
      if (result.token) response.setHeader('Set-Cookie', cookieValue(result.token, secure));
      response.json({ enabled: result.enabled, authenticated: result.authenticated, expiresAt: result.expiresAt || null });
    } catch (error) {
      response.status(error.status || 401).json({ error: error.message, code: error.code || 'AUTH_FAILED' });
    }
  });

  router.post('/auth/logout', (request, response) => {
    authService.logout(readCookie(request, AUTH_COOKIE_NAME));
    response.setHeader('Set-Cookie', cookieValue('', secure, 0));
    response.json({ enabled: authService.enabled, authenticated: !authService.enabled });
  });

  return router;
}

export function createAuthMiddleware(authService) {
  return (request, response, next) => {
    if (!authService?.enabled) return next();
    if (request.path.startsWith('/auth/') || request.path === '/webhooks/meta') return next();
    if (authService.authenticate(readCookie(request, AUTH_COOKIE_NAME))) {
      request.operatorAuthenticated = true;
      return next();
    }
    return response.status(401).json({ error: '請先登入單一操作員帳戶。', code: 'AUTH_REQUIRED' });
  };
}
