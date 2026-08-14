import crypto from 'node:crypto';
import { Router } from 'express';
import { createLegacyOwnerActor, permissionsForRole } from './access-control.js';
import { createSecurityMonitor } from './security-events.js';

export const AUTH_POLICY = Object.freeze({
  sessionTtlMs: 12 * 60 * 60 * 1000,
  maxSessions: 4,
  maxLoginAttempts: 5,
  loginLockoutMs: 5 * 60 * 1000,
  maxTrackedClients: 100,
});

export const AUTH_COOKIE_NAME = 'shrineflow_session';
export const AUTH_CSRF_COOKIE_NAME = 'shrineflow_csrf';

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

export function createAuthService({
  env = process.env,
  now = () => Date.now(),
  repositories = null,
  securityMonitor = repositories ? createSecurityMonitor({ repositories, now }) : null,
} = {}) {
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

  function recordSecurity(event) {
    if (!securityMonitor?.record) return;
    void securityMonitor.record(event).catch(() => {});
  }

  function verifyPassword(password = '') {
    if (!enabled || safeEqual(password, operatorPassword)) return true;
    throw authError('Password reauthentication failed.', 401, 'REAUTH_FAILED');
  }

  function login({ password = '', clientKey = 'local' } = {}) {
    prune();
    if (!enabled) return { enabled: false, authenticated: true, token: null };
    const key = String(clientKey || 'local').slice(0, 120);
    const current = now();
    const previous = loginAttempts.get(key) || { count: 0, lastAttemptAt: current, lockedUntil: 0 };
    if (previous.lockedUntil > current) {
      recordSecurity({
        type: 'login_blocked',
        ip: key,
        metadata: { count: previous.count, lockedUntil: previous.lockedUntil },
      });
      throw authError('登入嘗試過於頻繁，請稍後再試。', 429, 'AUTH_RATE_LIMITED');
    }
    if (!safeEqual(password, operatorPassword)) {
      const count = previous.count + 1;
      loginAttempts.set(key, {
        count,
        lastAttemptAt: current,
        lockedUntil: count >= AUTH_POLICY.maxLoginAttempts ? current + AUTH_POLICY.loginLockoutMs : 0,
      });
      recordSecurity({
        type: 'login_failed',
        ip: key,
        metadata: { count, locked: count >= AUTH_POLICY.maxLoginAttempts },
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
    recordSecurity({
      type: 'login_succeeded',
      actor: createLegacyOwnerActor(),
      ip: key,
      metadata: { mode: 'legacy' },
    });
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
    mode: enabled ? 'legacy' : 'disabled',
    status,
    login,
    authenticate,
    logout,
    reauthenticate({ password = '' } = {}) {
      verifyPassword(password);
      return { authenticated: true };
    },
    recordSecurity,
    policy: AUTH_POLICY,
  };
}

export function readCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  const match = cookies.map((part) => part.trim().split('='))
    .find(([key]) => key === name);
  return match ? match.slice(1).join('=') : '';
}

function cookieValue(token, secure = false, maxAge = AUTH_POLICY.sessionTtlMs / 1000) {
  return `${AUTH_COOKIE_NAME}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}

function csrfCookieValue(token, secure = false, maxAge = 60 * 60) {
  return `${AUTH_CSRF_COOKIE_NAME}=${token || ''}; Path=/; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`;
}

function publicActor(actor) {
  if (!actor) return null;
  return {
    uid: actor.uid,
    email: actor.email || '',
    displayName: actor.displayName || '',
    status: actor.status || 'active',
    systemRole: actor.systemRole || '',
    legacy: Boolean(actor.legacy),
    memberships: (actor.memberships || []).map((membership) => ({
      clientId: membership.clientId,
      role: membership.role,
      status: membership.status,
      permissions: permissionsForRole(membership.role),
    })),
  };
}

export function createAuthRouter({
  authService = createAuthService(),
  reauthService = null,
} = {}) {
  const router = Router();
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  router.get('/auth/config', (_request, response) => {
    response.json({
      enabled: Boolean(authService.enabled),
      mode: authService.mode || (authService.enabled ? 'legacy' : 'disabled'),
      firebase: authService.mode === 'firebase' ? authService.webConfig : null,
    });
  });

  router.get('/auth/csrf', (_request, response) => {
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    response.setHeader('Set-Cookie', csrfCookieValue(csrfToken, secure));
    response.json({ csrfToken });
  });

  router.get('/auth/status', async (request, response) => {
    response.json(await authService.status(readCookie(request, AUTH_COOKIE_NAME)));
  });

  router.post('/auth/login', async (request, response) => {
    try {
      if (typeof authService.login !== 'function') {
        return response.status(409).json({ error: '目前使用 Firebase 登入。', code: 'AUTH_MODE_FIREBASE' });
      }
      const result = await authService.login({
        password: request.body?.password,
        clientKey: request.ip,
      });
      if (result.token) response.setHeader('Set-Cookie', cookieValue(result.token, secure));
      response.json({
        enabled: result.enabled,
        authenticated: result.authenticated,
        mode: authService.mode || 'legacy',
        expiresAt: result.expiresAt || null,
      });
    } catch (error) {
      response.status(error.status || 401).json({ error: error.message, code: error.code || 'AUTH_FAILED' });
    }
  });

  router.post('/auth/session', async (request, response) => {
    try {
      if (typeof authService.createSession !== 'function') {
        return response.status(409).json({ error: '目前未啟用 Firebase 登入。', code: 'AUTH_MODE_NOT_FIREBASE' });
      }
      const csrfCookie = readCookie(request, AUTH_CSRF_COOKIE_NAME);
      const csrfToken = String(request.headers['x-csrf-token'] || request.body?.csrfToken || '');
      if (!csrfCookie || !csrfToken || !safeEqual(csrfCookie, csrfToken)) {
        return response.status(403).json({ error: '登入驗證已過期，請重新整理後再試。', code: 'AUTH_CSRF_INVALID' });
      }
      const result = await authService.createSession({
        idToken: request.body?.idToken,
        inviteToken: request.body?.inviteToken,
      });
      response.setHeader('Set-Cookie', [
        cookieValue(result.token, secure),
        csrfCookieValue('', secure, 0),
      ]);
      response.json({
        enabled: true,
        authenticated: true,
        mode: 'firebase',
        expiresAt: result.expiresAt,
        actor: publicActor(result.actor),
      });
      await authService.recordSecurity?.({
        type: 'login_succeeded',
        actor: result.actor,
        ip: request.ip,
        userAgent: request.get?.('User-Agent') || '',
        metadata: { mode: 'firebase' },
      });
    } catch (error) {
      response.status(error.status || 401).json({ error: error.message, code: error.code || 'AUTH_FAILED' });
    }
  });

  router.post('/auth/reauth', async (request, response) => {
    try {
      if (!reauthService?.enabled) {
        return response.status(503).json({
          error: 'Reauthentication is not configured.',
          code: 'REAUTH_UNAVAILABLE',
        });
      }
      const session = await authService.authenticate(readCookie(request, AUTH_COOKIE_NAME));
      if (!session?.actor) {
        return response.status(401).json({ error: 'Authentication is required.', code: 'AUTH_REQUIRED' });
      }
      if (typeof authService.reauthenticate !== 'function') {
        return response.status(409).json({ error: 'Reauthentication is not supported by this auth mode.', code: 'REAUTH_UNSUPPORTED' });
      }
      await authService.reauthenticate({
        password: request.body?.password,
        idToken: request.body?.idToken,
        actor: session.actor,
      });
      const token = reauthService.issue({ actorId: session.actor.uid });
      await authService.recordSecurity?.({
        type: 'reauth_succeeded',
        actor: session.actor,
        ip: request.ip,
        userAgent: request.get?.('User-Agent') || '',
        metadata: { mode: authService.mode || 'legacy' },
      });
      return response.json({ token, expiresInMs: reauthService.ttlMs });
    } catch (error) {
      await authService.recordSecurity?.({
        type: 'reauth_failed',
        ip: request.ip,
        userAgent: request.get?.('User-Agent') || '',
        metadata: { mode: authService.mode || 'unknown' },
      });
      return response.status(error.status || 401).json({
        error: error.message,
        code: error.code || 'REAUTH_FAILED',
      });
    }
  });

  async function logout(request, response) {
    await authService.logout?.(readCookie(request, AUTH_COOKIE_NAME));
    response.setHeader('Set-Cookie', [
      cookieValue('', secure, 0),
      csrfCookieValue('', secure, 0),
    ]);
    response.json({ enabled: authService.enabled, authenticated: !authService.enabled, mode: authService.mode || 'disabled' });
  }

  router.post('/auth/logout', logout);
  router.delete('/auth/session', logout);

  router.get('/me', async (request, response) => {
    try {
      if (!authService.enabled) return response.json({ actor: publicActor(createLegacyOwnerActor()), mode: 'disabled' });
      const result = await authService.authenticate(readCookie(request, AUTH_COOKIE_NAME));
      if (!result) return response.status(401).json({ error: '登入已過期，請重新登入。', code: 'AUTH_REQUIRED' });
      response.json({ actor: publicActor(result.actor || createLegacyOwnerActor()), mode: authService.mode || 'legacy' });
    } catch {
      response.status(401).json({ error: '登入已過期，請重新登入。', code: 'AUTH_REQUIRED' });
    }
  });

  return router;
}

export function createAuthMiddleware(authService) {
  return async (request, response, next) => {
    if (!authService?.enabled) {
      request.operatorAuthenticated = true;
      request.actor = createLegacyOwnerActor();
      return next();
    }
    if (request.path.startsWith('/auth/') || request.path === '/webhooks/meta') return next();
    try {
      const authenticated = await authService.authenticate(readCookie(request, AUTH_COOKIE_NAME));
      if (authenticated) {
        request.operatorAuthenticated = true;
        request.actor = authenticated.actor || createLegacyOwnerActor();
        return next();
      }
    } catch {
      // Invalid, expired, or revoked cookies share the same public response.
    }
    return response.status(401).json({ error: '請先登入 ShrineFlow。', code: 'AUTH_REQUIRED' });
  };
}
