export const ROLES = Object.freeze([
  'owner',
  'admin',
  'editor',
  'reviewer',
  'publisher',
  'viewer',
]);

export const PERMISSIONS = Object.freeze([
  'content.view',
  'content.create',
  'content.edit',
  'content.submit_review',
  'content.approve',
  'content.archive',
  'schedule.manage',
  'publish.execute',
  'publish.retry',
  'media.manage',
  'template.manage',
  'campaign.manage',
  'inbox.reply',
  'account.manage',
  'member.manage',
  'audit.view',
  'system.manage',
]);

const VIEW = Object.freeze(['content.view']);
const CONTENT = Object.freeze([
  ...VIEW,
  'content.create',
  'content.edit',
  'content.submit_review',
  'content.archive',
  'media.manage',
  'template.manage',
  'campaign.manage',
]);
const PUBLISH = Object.freeze([
  ...CONTENT,
  'schedule.manage',
  'publish.execute',
  'publish.retry',
  'inbox.reply',
]);
const ADMIN = Object.freeze([
  ...PUBLISH,
  'content.approve',
  'account.manage',
  'member.manage',
  'audit.view',
]);

export const ROLE_PERMISSIONS = Object.freeze({
  // Brand owner matches admin for API permissions. system.manage is systemRole-only.
  owner: ADMIN,
  admin: ADMIN,
  editor: CONTENT,
  reviewer: Object.freeze([...VIEW, 'content.approve']),
  publisher: PUBLISH,
  viewer: VIEW,
});

export class AuthorizationError extends Error {
  constructor(message = '你沒有執行此操作的權限。', {
    status = 403,
    code = 'PERMISSION_DENIED',
  } = {}) {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!ROLES.includes(normalized)) {
    const error = new Error(`不支援的角色「${normalized || '空白'}」。`);
    error.code = 'ROLE_INVALID';
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)].slice();
}

export function roleHasPermission(role, permission) {
  if (!PERMISSIONS.includes(permission)) return false;
  try {
    return ROLE_PERMISSIONS[normalizeRole(role)].includes(permission);
  } catch {
    return false;
  }
}

export function membershipId(clientId, userId) {
  const normalizedClientId = String(clientId || '').trim();
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedClientId || !normalizedUserId || normalizedClientId.includes('/') || normalizedUserId.includes('/')) {
    const error = new Error('Membership 需要有效的 clientId 與 userId。');
    error.code = 'MEMBERSHIP_ID_INVALID';
    error.status = 400;
    throw error;
  }
  return `${normalizedClientId}__${normalizedUserId}`;
}

export function createActor({ user = {}, memberships = [], systemRole = '' } = {}) {
  const uid = String(user.uid || user.id || '').trim();
  if (!uid) return null;
  return Object.freeze({
    type: 'user',
    uid,
    email: String(user.email || '').trim().toLowerCase(),
    displayName: String(user.displayName || '').trim(),
    status: user.status || 'active',
    systemRole: systemRole ? normalizeRole(systemRole) : '',
    memberships: Object.freeze((memberships || [])
      .filter((membership) => membership?.userId === uid && membership?.status !== 'revoked')
      .map((membership) => Object.freeze({
        id: membership.id,
        clientId: membership.clientId,
        role: normalizeRole(membership.role),
        status: membership.status || 'active',
      }))),
  });
}

export function createLegacyOwnerActor() {
  return Object.freeze({
    type: 'user',
    uid: 'legacy:operator',
    email: '',
    displayName: 'Legacy Operator',
    status: 'active',
    systemRole: 'owner',
    legacy: true,
    wildcardClientAccess: true,
    memberships: Object.freeze([]),
  });
}

function actorIsSystemOwner(actor) {
  if (!actor || actor.status === 'suspended') return false;
  if (actor.legacy && actor.wildcardClientAccess) return true;
  return actor.systemRole === 'owner';
}

export function actorMembership(actor, clientId) {
  if (!actor || actor.status === 'suspended') return null;
  if (actor.legacy && actor.wildcardClientAccess) {
    return { id: 'legacy:*', clientId, userId: actor.uid, role: 'owner', status: 'active' };
  }
  return (actor.memberships || []).find((membership) => (
    membership.clientId === clientId && membership.status === 'active'
  )) || null;
}

export function actorHasPermission(actor, permission, clientId = '') {
  if (!actor || actor.status === 'suspended' || !PERMISSIONS.includes(permission)) return false;
  if (permission === 'system.manage') return actorIsSystemOwner(actor);
  if (actorIsSystemOwner(actor)) return roleHasPermission('owner', permission);
  if (!clientId) return Boolean(actor.systemRole && roleHasPermission(actor.systemRole, permission));
  const membership = actorMembership(actor, clientId);
  return Boolean(membership && roleHasPermission(membership.role, permission));
}

export function actorHasAnyPermission(actor, permission) {
  if (!actor || actor.status === 'suspended' || !PERMISSIONS.includes(permission)) return false;
  if (permission === 'system.manage') return actorIsSystemOwner(actor);
  if (actor.legacy && actor.wildcardClientAccess) return roleHasPermission('owner', permission);
  if (actor.systemRole && roleHasPermission(actor.systemRole, permission)) return true;
  return (actor.memberships || []).some((membership) => (
    membership.status === 'active' && roleHasPermission(membership.role, permission)
  ));
}

export function accessibleClientIds(actor, permission = 'content.view') {
  if (!actor || actor.status === 'suspended') return [];
  if (actor.legacy && actor.wildcardClientAccess) return null;
  if (actorIsSystemOwner(actor)) return null;
  return [...new Set((actor.memberships || [])
    .filter((membership) => (
      membership.status === 'active' && roleHasPermission(membership.role, permission)
    ))
    .map((membership) => membership.clientId)
    .filter(Boolean))];
}

export function assertActorPermission(actor, permission, clientId = '') {
  if (!actor) {
    throw new AuthorizationError('請先登入後再繼續。', { status: 401, code: 'AUTH_REQUIRED' });
  }
  if (actor.status === 'suspended') {
    throw new AuthorizationError('此帳號已暫停使用。', { status: 403, code: 'USER_SUSPENDED' });
  }
  if (!actorHasPermission(actor, permission, clientId)) throw new AuthorizationError();
  return clientId ? actorMembership(actor, clientId) : null;
}

export function requirePermission(permission, { resolveClientId } = {}) {
  if (!PERMISSIONS.includes(permission)) throw new Error(`Unknown permission: ${permission}`);
  return async (request, response, next) => {
    try {
      const clientId = typeof resolveClientId === 'function'
        ? String(await resolveClientId(request) || '').trim()
        : '';
      request.membership = assertActorPermission(request.actor, permission, clientId);
      request.authorizedClientId = clientId;
      return next();
    } catch (error) {
      return response.status(error.status || 403).json({
        error: error.message || '你沒有執行此操作的權限。',
        code: error.code || 'PERMISSION_DENIED',
      });
    }
  };
}
