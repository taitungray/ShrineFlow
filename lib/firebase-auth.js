import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { createActor, permissionsForRole } from './access-control.js';
import {
  acceptInvitation,
  bootstrapOwner,
  listMembershipsForUser,
  normalizeEmail,
  upsertUser,
} from './access-data.js';
import { createAuthService, AUTH_POLICY } from './auth.js';
import { getRepositories } from './repositories.js';

function authError(message, status = 401, code = 'AUTH_FAILED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function csvSet(value, normalizer = (item) => item) {
  return new Set(String(value || '').split(',').map((item) => normalizer(item.trim())).filter(Boolean));
}

function firebaseWebConfig(env = process.env) {
  return {
    apiKey: String(env.FIREBASE_API_KEY || '').trim(),
    authDomain: String(env.FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: String(env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '').trim(),
    appId: String(env.FIREBASE_APP_ID || '').trim(),
  };
}

function serviceAccountCredential(env) {
  const raw = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return applicationDefault();
  try {
    return cert(JSON.parse(raw));
  } catch (error) {
    throw authError(`GOOGLE_SERVICE_ACCOUNT_JSON 格式錯誤：${error.message}`, 503, 'FIREBASE_CREDENTIAL_INVALID');
  }
}

export function createFirebaseAdminAuth({ env = process.env } = {}) {
  const projectId = String(env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '').trim();
  const appName = 'shrineflow-auth';
  const existing = getApps().find((app) => app.name === appName);
  const app = existing || initializeApp({
    credential: serviceAccountCredential(env),
    ...(projectId ? { projectId } : {}),
  }, appName);
  return getAuth(app);
}

function identityFromClaims(claims = {}) {
  return {
    uid: String(claims.uid || claims.sub || '').trim(),
    email: normalizeEmail(claims.email),
    displayName: String(claims.name || '').trim(),
    photoUrl: String(claims.picture || '').trim(),
    authProvider: String(claims.firebase?.sign_in_provider || '').trim(),
    emailVerified: claims.email_verified === true,
    lastLoginAt: new Date().toISOString(),
  };
}

function publicActor(actor) {
  if (!actor) return null;
  return {
    uid: actor.uid,
    email: actor.email,
    displayName: actor.displayName,
    status: actor.status,
    systemRole: actor.systemRole || '',
    memberships: (actor.memberships || []).map((membership) => ({
      clientId: membership.clientId,
      role: membership.role,
      status: membership.status,
      permissions: permissionsForRole(membership.role),
    })),
  };
}

export function createFirebaseSessionAuthService({
  firebaseAuth,
  repositories = getRepositories(),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  if (!firebaseAuth) throw authError('Firebase Admin Auth 尚未初始化。', 503, 'FIREBASE_AUTH_REQUIRED');
  const ownerEmails = csvSet(env.SHRINEFLOW_OWNER_EMAILS, normalizeEmail);
  const ownerUids = csvSet(env.SHRINEFLOW_OWNER_UIDS);
  const webConfig = firebaseWebConfig(env);
  const checkRevoked = String(env.SHRINEFLOW_CHECK_REVOKED_SESSIONS || '').toLowerCase() === 'true';

  async function actorForUid(uid) {
    const user = await repositories.users.getById(uid);
    if (!user || user.status === 'suspended') return null;
    const memberships = await listMembershipsForUser(uid, repositories);
    if (!memberships.length && user.systemRole !== 'owner') return null;
    return createActor({ user, memberships, systemRole: user.systemRole || '' });
  }

  async function authorizeIdentity(identity, inviteToken = '') {
    if (!identity.uid) throw authError('Firebase Token 缺少 UID。', 401, 'AUTH_IDENTITY_INVALID');
    if (!identity.email || !identity.emailVerified) {
      throw authError('請使用已驗證 Email 的帳號登入。', 403, 'AUTH_EMAIL_UNVERIFIED');
    }

    const existing = await repositories.users.getById(identity.uid);
    if (existing?.status === 'suspended') {
      throw authError('此帳號已暫停使用。', 403, 'USER_SUSPENDED');
    }

    const existingMemberships = existing
      ? await listMembershipsForUser(identity.uid, repositories)
      : [];
    if (existing && (existingMemberships.length || existing.systemRole === 'owner')) {
      const user = await upsertUser({ ...identity, status: existing.status }, repositories);
      return createActor({ user, memberships: existingMemberships, systemRole: user.systemRole || '' });
    }

    if (inviteToken) {
      const accepted = await acceptInvitation({ token: inviteToken, user: identity }, repositories, { now });
      return createActor({ user: accepted.user, memberships: accepted.memberships });
    }

    if (ownerEmails.has(identity.email) || ownerUids.has(identity.uid)) {
      const bootstrapped = await bootstrapOwner(identity, repositories);
      return createActor({
        user: bootstrapped.user,
        memberships: bootstrapped.memberships,
        systemRole: 'owner',
      });
    }

    throw authError('此帳號尚未受邀使用 ShrineFlow。', 403, 'AUTH_NOT_INVITED');
  }

  async function createSession({ idToken = '', inviteToken = '' } = {}) {
    if (!idToken) throw authError('缺少 Firebase ID Token。', 400, 'AUTH_ID_TOKEN_REQUIRED');
    const claims = await firebaseAuth.verifyIdToken(idToken, true);
    const actor = await authorizeIdentity(identityFromClaims(claims), inviteToken);
    const token = await firebaseAuth.createSessionCookie(idToken, { expiresIn: AUTH_POLICY.sessionTtlMs });
    return {
      enabled: true,
      authenticated: true,
      mode: 'firebase',
      token,
      expiresAt: new Date(now() + AUTH_POLICY.sessionTtlMs).toISOString(),
      actor,
    };
  }

  async function authenticate(rawToken = '') {
    if (!rawToken) return null;
    const claims = await firebaseAuth.verifySessionCookie(rawToken, checkRevoked);
    const actor = await actorForUid(String(claims.uid || claims.sub || ''));
    if (!actor) return null;
    return {
      enabled: true,
      authenticated: true,
      mode: 'firebase',
      expiresAt: claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : null,
      actor,
    };
  }

  async function status(rawToken = '') {
    try {
      const result = await authenticate(rawToken);
      if (!result) return { enabled: true, authenticated: false, mode: 'firebase' };
      return { ...result, actor: publicActor(result.actor) };
    } catch {
      return { enabled: true, authenticated: false, mode: 'firebase' };
    }
  }

  async function revokeSessions(uid) {
    if (uid) await firebaseAuth.revokeRefreshTokens(uid);
  }

  return Object.freeze({
    enabled: true,
    mode: 'firebase',
    policy: AUTH_POLICY,
    webConfig,
    status,
    authenticate,
    createSession,
    revokeSessions,
    async logout() { return { enabled: true, authenticated: false, mode: 'firebase' }; },
  });
}

export function createEnvironmentAuthService({
  env = process.env,
  repositories = getRepositories(),
  firebaseAuth,
} = {}) {
  const requestedMode = String(env.SHRINEFLOW_AUTH_MODE || '').trim().toLowerCase();
  const mode = requestedMode || ((env.SHRINEFLOW_OPERATOR_PASSWORD && env.SHRINEFLOW_SESSION_SECRET) ? 'legacy' : 'disabled');
  if (mode === 'firebase') {
    return createFirebaseSessionAuthService({
      firebaseAuth: firebaseAuth || createFirebaseAdminAuth({ env }),
      repositories,
      env,
    });
  }
  if (!['legacy', 'disabled'].includes(mode)) {
    throw authError(`不支援的 SHRINEFLOW_AUTH_MODE「${mode}」。`, 503, 'AUTH_MODE_INVALID');
  }
  return createAuthService({ env: mode === 'disabled' ? {} : env });
}
