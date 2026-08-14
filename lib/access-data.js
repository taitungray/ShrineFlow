import crypto from 'node:crypto';

import { getRepositories } from './repositories.js';
import { makeId } from './store.js';
import { assertCollectionCapacity } from './storage-policy.js';
import { membershipId, normalizeRole } from './access-control.js';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export async function upsertUser(input = {}, repositories = getRepositories()) {
  const uid = String(input.uid || input.id || '').trim();
  if (!uid) throw new Error('User uid is required.');
  const now = input.updatedAt || new Date().toISOString();
  const existing = await repositories.users.getById(uid);
  const next = {
    ...(existing || {}),
    id: uid,
    uid,
    email: normalizeEmail(input.email ?? existing?.email),
    emailNormalized: normalizeEmail(input.email ?? existing?.email),
    displayName: String(input.displayName ?? existing?.displayName ?? '').trim(),
    photoUrl: String(input.photoUrl ?? existing?.photoUrl ?? '').trim(),
    authProvider: String(input.authProvider ?? existing?.authProvider ?? '').trim(),
    status: input.status === 'suspended' ? 'suspended' : 'active',
    lastLoginAt: input.lastLoginAt ?? existing?.lastLoginAt ?? null,
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
  if (existing) return repositories.users.update(uid, next);
  const users = await repositories.users.list();
  assertCollectionCapacity('users', users.length, 1);
  return repositories.users.create(next);
}

export async function listMembershipsForUser(userId, repositories = getRepositories()) {
  return repositories.memberships.query({
    filters: { userId: String(userId || '').trim(), status: 'active' },
    orderBy: 'createdAt',
  });
}

export async function listMembershipsForClient(clientId, repositories = getRepositories()) {
  return repositories.memberships.query({
    filters: { clientId: String(clientId || '').trim(), status: 'active' },
    orderBy: 'createdAt',
  });
}

export async function upsertMembership(input = {}, repositories = getRepositories()) {
  const clientId = String(input.clientId || '').trim();
  const userId = String(input.userId || '').trim();
  const role = normalizeRole(input.role);
  const id = membershipId(clientId, userId);
  const now = input.updatedAt || new Date().toISOString();
  const existing = await repositories.memberships.getById(id);
  const next = {
    ...(existing || {}),
    id,
    clientId,
    userId,
    role,
    status: input.status === 'revoked' ? 'revoked' : 'active',
    invitedBy: String(input.invitedBy ?? existing?.invitedBy ?? '').trim(),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
  if (existing) return repositories.memberships.update(id, next);
  const memberships = await repositories.memberships.list();
  assertCollectionCapacity('memberships', memberships.length, 1);
  return repositories.memberships.create(next);
}

export async function revokeMembership(clientId, userId, repositories = getRepositories()) {
  const id = membershipId(clientId, userId);
  return repositories.memberships.update(id, (membership) => ({
    ...membership,
    status: 'revoked',
    updatedAt: new Date().toISOString(),
  }));
}

function invitationHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeInvitationGrants(grants = []) {
  const unique = new Map();
  for (const grant of grants) {
    const clientId = String(grant?.clientId || '').trim();
    if (!clientId) continue;
    unique.set(clientId, { clientId, role: normalizeRole(grant.role) });
  }
  if (!unique.size) {
    const error = new Error('邀請至少需要一個品牌角色。');
    error.code = 'INVITATION_GRANT_REQUIRED';
    error.status = 400;
    throw error;
  }
  return [...unique.values()];
}

export async function createInvitation(input = {}, repositories = getRepositories(), {
  now = () => Date.now(),
  tokenFactory = () => crypto.randomBytes(32).toString('base64url'),
} = {}) {
  const emailNormalized = normalizeEmail(input.email || input.emailNormalized);
  if (!emailNormalized || !emailNormalized.includes('@')) {
    const error = new Error('請輸入有效的邀請 Email。');
    error.code = 'INVITATION_EMAIL_INVALID';
    error.status = 400;
    throw error;
  }
  const invitations = await repositories.invitations.list();
  assertCollectionCapacity('invitations', invitations.length, 1);
  const token = tokenFactory();
  const createdAt = new Date(now()).toISOString();
  const expiresAt = new Date(now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitation = {
    id: makeId(),
    emailNormalized,
    grants: normalizeInvitationGrants(input.grants),
    status: 'pending',
    tokenHash: invitationHash(token),
    expiresAt,
    invitedBy: String(input.invitedBy || '').trim(),
    acceptedBy: null,
    acceptedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
  await repositories.invitations.create(invitation);
  return { invitation, token };
}

export async function findInvitationByToken(token, repositories = getRepositories()) {
  const matches = await repositories.invitations.query({
    filters: { tokenHash: invitationHash(token) },
    limit: 1,
  });
  return matches[0] || null;
}
