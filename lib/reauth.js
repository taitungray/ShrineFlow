import crypto from 'node:crypto';

export const REAUTH_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function error(message, status, code) {
  const result = new Error(message);
  result.status = status;
  result.code = code;
  return result;
}

export function createReauthService({
  secret = '',
  now = () => Date.now(),
  ttlMs = REAUTH_TTL_MS,
  required = false,
} = {}) {
  const key = String(secret || '').trim();
  const enabled = Boolean(key);
  const ttl = Math.max(60 * 1000, Number(ttlMs) || REAUTH_TTL_MS);

  function signature(payload) {
    return crypto.createHmac('sha256', key).update(payload).digest('base64url');
  }

  function issue({ actorId, authTime = now() } = {}) {
    if (!enabled) return null;
    const uid = String(actorId || '').trim();
    if (!uid) throw error('Reauthentication actor is required.', 400, 'REAUTH_ACTOR_REQUIRED');
    const issuedAt = Number(now());
    const payload = base64url(JSON.stringify({
      actorId: uid,
      iat: issuedAt,
      exp: issuedAt + ttl,
      authTime: Number(authTime) || issuedAt,
      nonce: crypto.randomBytes(12).toString('base64url'),
    }));
    return `${payload}.${signature(payload)}`;
  }

  function verify(token, { actorId } = {}) {
    if (!enabled) throw error('Reauthentication is not configured.', 503, 'REAUTH_UNAVAILABLE');
    const [payload, provided] = String(token || '').split('.');
    if (!payload || !provided || !safeEqual(signature(payload), provided)) {
      throw error('Recent reauthentication is required.', 401, 'REAUTH_REQUIRED');
    }
    let claims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw error('Recent reauthentication is required.', 401, 'REAUTH_REQUIRED');
    }
    const timestamp = Number(now());
    if (!claims?.actorId || (actorId && claims.actorId !== String(actorId))
      || Number(claims.iat) > timestamp + CLOCK_SKEW_MS
      || Number(claims.exp) <= timestamp) {
      throw error('Recent reauthentication is required.', 401, 'REAUTH_REQUIRED');
    }
    return claims;
  }

  function assertRequest(request, actor) {
    if (!required) return null;
    if (!enabled) throw error('Reauthentication is not configured.', 503, 'REAUTH_UNAVAILABLE');
    return verify(request.headers?.['x-reauth-token'], { actorId: actor?.uid });
  }

  return Object.freeze({ enabled, required, ttlMs: ttl, issue, verify, assertRequest });
}
