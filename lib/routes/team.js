import { Router } from 'express';

import {
  accessibleClientIds,
  actorMembership,
  assertActorPermission,
  normalizeRole,
  permissionsForRole,
} from '../access-control.js';
import {
  createInvitation,
  listMembershipsForClient,
  revokeMembership,
  upsertMembership,
  upsertUser,
} from '../access-data.js';
import { getClientRaw, updateClientWorkflow } from '../clients.js';
import { appendAuditEvent } from '../audit-log.js';
import { getRepositories } from '../repositories.js';

function routeError(message, status = 400, code = 'TEAM_REQUEST_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sendError(response, error) {
  return response.status(error.status || 400).json({
    error: error.message || '團隊管理請求失敗。',
    code: error.code || 'TEAM_REQUEST_INVALID',
  });
}

function publicInvitation(invitation) {
  if (!invitation) return null;
  const { tokenHash: _tokenHash, ...safe } = invitation;
  return safe;
}

function publicUser(user = {}) {
  return {
    uid: user.uid || user.id,
    email: user.email || '',
    displayName: user.displayName || '',
    photoUrl: user.photoUrl || '',
    status: user.status || 'active',
    lastLoginAt: user.lastLoginAt || null,
  };
}

function canAssignOwner(actor, clientId) {
  return actor?.legacy || actor?.systemRole === 'owner' || actorMembership(actor, clientId)?.role === 'owner';
}

function canViewGlobalAudit(actor) {
  return Boolean(actor?.legacy || actor?.systemRole === 'owner');
}

function auditEventVisible(request, event, clientId, allowedClientIds) {
  const matchesClient = !clientId
    || event.clientId === clientId
    || (canViewGlobalAudit(request.actor) && !event.clientId);
  const inScope = event.clientId
    ? (allowedClientIds === null || allowedClientIds.includes(event.clientId))
    : canViewGlobalAudit(request.actor);
  return matchesClient && inScope;
}

function auditEventsForRequest(request, events, limit = 100) {
  const clientId = String(request.query.clientId || '').trim();
  const allowedClientIds = accessibleClientIds(request.actor, 'audit.view');
  const action = String(request.query.action || '').trim();
  const actorId = String(request.query.actorId || '').trim();
  const from = Date.parse(String(request.query.from || ''));
  const to = Date.parse(String(request.query.to || ''));
  return events
    .filter((event) => (
      auditEventVisible(request, event, clientId, allowedClientIds)
      && (!action || event.action === action)
      && (!actorId || event.actorId === actorId)
      && (!Number.isFinite(from) || Date.parse(event.createdAt) >= from)
      && (!Number.isFinite(to) || Date.parse(event.createdAt) <= to)
    ))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 5000));
}

function csvCell(value) {
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function auditEventsCsv(events) {
  const fields = ['id', 'clientId', 'actorId', 'actorEmail', 'action', 'resourceType', 'resourceId', 'requestId', 'ip', 'userAgent', 'createdAt', 'metadata'];
  return [
    fields.join(','),
    ...events.map((event) => fields.map((field) => csvCell(event[field])).join(',')),
  ].join('\n') + '\n';
}

async function activeOwnerMemberships(clientId, repositories) {
  const memberships = (await listMembershipsForClient(clientId, repositories))
    .filter((membership) => membership.role === 'owner');
  const active = [];
  for (const membership of memberships) {
    const user = await repositories.users.getById(membership.userId);
    if (!user || user.status !== 'suspended') active.push(membership);
  }
  return active;
}

async function assertOwnerContinuity(clientId, userId, repositories) {
  const owners = await activeOwnerMemberships(clientId, repositories);
  if (owners.some((membership) => membership.userId === userId) && owners.length <= 1) {
    throw routeError('每個品牌至少需要一位啟用中的 Owner。', 409, 'LAST_OWNER_REQUIRED');
  }
}

async function audit(action, request, repositories, details = {}) {
  await appendAuditEvent({
    actor: request.actor,
    clientId: details.clientId || '',
    action,
    resourceType: details.resourceType || '',
    resourceId: details.resourceId || '',
    requestId: request.get?.('X-Request-Id') || '',
    metadata: details.metadata || {},
    ip: request.ip,
    userAgent: request.get?.('User-Agent') || '',
  }, repositories);
}

export function createTeamRouter({
  repositories = getRepositories(),
  authService,
  invitationMailer = null,
} = {}) {
  const router = Router();

  router.patch('/clients/:clientId/workflow', async (request, response) => {
    try {
      const { clientId } = request.params;
      assertActorPermission(request.actor, 'member.manage', clientId);
      const current = await getClientRaw(clientId, repositories);
      if (!current) throw routeError('?曆??啣???', 404, 'CLIENT_NOT_FOUND');
      const updated = await updateClientWorkflow(clientId, {
        approvalRequired: request.body?.approvalRequired,
      }, repositories);
      await audit('client.workflow_updated', request, repositories, {
        clientId,
        resourceType: 'client',
        resourceId: clientId,
        metadata: {
          approvalRequired: Boolean(updated?.approvalRequired),
        },
      });
      response.json(updated);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/clients/:clientId/members', async (request, response) => {
    try {
      const { clientId } = request.params;
      assertActorPermission(request.actor, 'member.manage', clientId);
      const memberships = await listMembershipsForClient(clientId, repositories);
      const members = await Promise.all(memberships.map(async (membership) => {
        const user = await repositories.users.getById(membership.userId);
        return {
          ...membership,
          rolePermissions: permissionsForRole(membership.role),
          user: publicUser(user || { uid: membership.userId, status: 'active' }),
        };
      }));
      response.json({ clientId, members });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.patch('/clients/:clientId/members/:userId', async (request, response) => {
    try {
      const { clientId, userId } = request.params;
      const actingMembership = assertActorPermission(request.actor, 'member.manage', clientId);
      const current = await repositories.memberships.getById(`${clientId}__${userId}`);
      if (!current || current.status !== 'active') throw routeError('找不到這位品牌成員。', 404, 'MEMBER_NOT_FOUND');
      const role = normalizeRole(request.body?.role);
      const actorIsOwner = canAssignOwner(request.actor, clientId);
      if (!actorIsOwner && (current.role === 'owner' || role === 'owner')) {
        throw routeError('只有 Owner 可以新增或調整 Owner。', 403, 'OWNER_ROLE_REQUIRED');
      }
      if (current.role === 'owner' && role !== 'owner') {
        await assertOwnerContinuity(clientId, userId, repositories);
      }
      const updated = await upsertMembership({
        ...current,
        role,
        status: 'active',
        updatedAt: new Date().toISOString(),
      }, repositories);
      await audit('membership.role_changed', request, repositories, {
        clientId,
        resourceType: 'membership',
        resourceId: updated.id,
        metadata: { fromRole: current.role, toRole: role, actingRole: actingMembership?.role || request.actor?.systemRole },
      });
      response.json({ ...updated, rolePermissions: permissionsForRole(updated.role) });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.delete('/clients/:clientId/members/:userId', async (request, response) => {
    try {
      const { clientId, userId } = request.params;
      assertActorPermission(request.actor, 'member.manage', clientId);
      const current = await repositories.memberships.getById(`${clientId}__${userId}`);
      if (!current || current.status !== 'active') throw routeError('找不到這位品牌成員。', 404, 'MEMBER_NOT_FOUND');
      if (!canAssignOwner(request.actor, clientId) && current.role === 'owner') {
        throw routeError('只有 Owner 可以移除 Owner。', 403, 'OWNER_ROLE_REQUIRED');
      }
      if (current.role === 'owner') await assertOwnerContinuity(clientId, userId, repositories);
      const revoked = await revokeMembership(clientId, userId, repositories);
      await authService?.revokeSessions?.(userId);
      await audit('membership.revoked', request, repositories, {
        clientId,
        resourceType: 'membership',
        resourceId: current.id,
        metadata: { role: current.role },
      });
      response.json({ ...revoked, rolePermissions: [] });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/invitations', async (request, response) => {
    try {
      const grants = Array.isArray(request.body?.grants) ? request.body.grants : [];
      if (!grants.length) throw routeError('請至少選擇一個品牌與角色。', 400, 'INVITATION_GRANT_REQUIRED');
      const normalizedGrants = grants.map((grant) => ({
        clientId: String(grant?.clientId || '').trim(),
        role: normalizeRole(grant?.role),
      }));
      for (const grant of normalizedGrants) {
        assertActorPermission(request.actor, 'member.manage', grant.clientId);
        if (grant.role === 'owner' && !canAssignOwner(request.actor, grant.clientId)) {
          throw routeError('只有 Owner 可以邀請新的 Owner。', 403, 'OWNER_ROLE_REQUIRED');
        }
        if (!await repositories.clients.getById(grant.clientId)) {
          throw routeError('找不到邀請指定的品牌。', 404, 'CLIENT_NOT_FOUND');
        }
      }
      const result = await createInvitation({
        email: request.body?.email,
        grants: normalizedGrants,
        invitedBy: request.actor.uid,
      }, repositories);
      for (const grant of normalizedGrants) {
        await audit('invitation.created', request, repositories, {
          clientId: grant.clientId,
          resourceType: 'invitation',
          resourceId: result.invitation.id,
          metadata: { email: result.invitation.emailNormalized, role: grant.role },
        });
      }
      const origin = `${request.protocol}://${request.get('host')}`;
      const invitationUrl = origin + '/?invite=' + encodeURIComponent(result.token);
      const emailDelivery = await invitationMailer?.send?.({
        email: result.invitation.emailNormalized,
        invitationUrl,
        grants: normalizedGrants,
        invitedBy: request.actor.uid,
      }) || { enabled: false, delivered: false };
      response.status(201).json({
        invitation: publicInvitation(result.invitation),
        invitationToken: result.token,
        invitationUrl,
        emailDelivery,
      });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/invitations', async (request, response) => {
    try {
      const requestedClientId = String(request.query.clientId || '').trim();
      if (requestedClientId) assertActorPermission(request.actor, 'member.manage', requestedClientId);
      const allowedClientIds = accessibleClientIds(request.actor, 'member.manage');
      const invitations = (await repositories.invitations.list())
        .filter((invitation) => (invitation.grants || []).some((grant) => (
          (!requestedClientId || grant.clientId === requestedClientId)
          && (allowedClientIds === null || allowedClientIds.includes(grant.clientId))
        )))
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .slice(0, 100)
        .map((invitation) => publicInvitation({
          ...invitation,
          grants: (invitation.grants || []).filter((grant) => (
            (!requestedClientId || grant.clientId === requestedClientId)
            && (allowedClientIds === null || allowedClientIds.includes(grant.clientId))
          )),
        }));
      response.json({ invitations });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/invitations/:invitationId/revoke', async (request, response) => {
    try {
      const invitation = await repositories.invitations.getById(request.params.invitationId);
      if (!invitation) throw routeError('找不到邀請。', 404, 'INVITATION_NOT_FOUND');
      if (invitation.status !== 'pending') throw routeError('只有待接受的邀請可以撤銷。', 409, 'INVITATION_NOT_PENDING');
      for (const grant of invitation.grants || []) {
        assertActorPermission(request.actor, 'member.manage', grant.clientId);
        if (grant.role === 'owner' && !canAssignOwner(request.actor, grant.clientId)) {
          throw routeError('只有 Owner 可以撤銷 Owner 邀請。', 403, 'OWNER_ROLE_REQUIRED');
        }
      }
      const updated = await repositories.invitations.update(invitation.id, {
        status: 'revoked',
        updatedAt: new Date().toISOString(),
      });
      for (const grant of invitation.grants || []) {
        await audit('invitation.revoked', request, repositories, {
          clientId: grant.clientId,
          resourceType: 'invitation',
          resourceId: invitation.id,
          metadata: { email: invitation.emailNormalized, role: grant.role },
        });
      }
      response.json({ invitation: publicInvitation(updated) });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.patch('/users/:userId', async (request, response) => {
    try {
      assertActorPermission(request.actor, 'system.manage');
      const user = await repositories.users.getById(request.params.userId);
      if (!user) throw routeError('找不到使用者。', 404, 'USER_NOT_FOUND');
      if (user.uid === request.actor.uid && request.body?.status === 'suspended') {
        throw routeError('不能停權目前登入中的自己。', 409, 'SELF_SUSPEND_BLOCKED');
      }
      const status = request.body?.status === 'suspended' ? 'suspended' : 'active';
      if (status === 'suspended') {
        const memberships = await repositories.memberships.query({
          filters: { userId: user.uid },
        });
        for (const membership of memberships.filter((item) => item.status === 'active' && item.role === 'owner')) {
          await assertOwnerContinuity(membership.clientId, user.uid, repositories);
        }
      }
      const updated = await upsertUser({
        ...user,
        status,
        updatedAt: new Date().toISOString(),
      }, repositories);
      if (status === 'suspended') await authService?.revokeSessions?.(user.uid);
      await audit(status === 'suspended' ? 'user.suspended' : 'user.reactivated', request, repositories, {
        resourceType: 'user', resourceId: user.uid, metadata: { email: user.email },
      });
      response.json({ user: publicUser(updated) });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/audit-events', async (request, response) => {
    try {
      const clientId = String(request.query.clientId || '').trim();
      if (clientId) assertActorPermission(request.actor, 'audit.view', clientId);
      const allowedClientIds = accessibleClientIds(request.actor, 'audit.view');
      const action = String(request.query.action || '').trim();
      const actorId = String(request.query.actorId || '').trim();
      const from = Date.parse(String(request.query.from || ''));
      const to = Date.parse(String(request.query.to || ''));
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 100);
      const events = (await repositories.auditEvents.list())
        .filter((event) => (
          auditEventVisible(request, event, clientId, allowedClientIds)
          && (!action || event.action === action)
          && (!actorId || event.actorId === actorId)
          && (!Number.isFinite(from) || Date.parse(event.createdAt) >= from)
          && (!Number.isFinite(to) || Date.parse(event.createdAt) <= to)
        ))
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .slice(0, limit);
      response.json({ events });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get('/audit-events/export', async (request, response) => {
    try {
      const clientId = String(request.query.clientId || '').trim();
      if (clientId) assertActorPermission(request.actor, 'audit.view', clientId);
      const events = auditEventsForRequest(
        request,
        await repositories.auditEvents.list(),
        request.query.limit || 5000,
      );
      response.setHeader('Cache-Control', 'no-store');
      if (String(request.query.format || '').toLowerCase() === 'json') {
        response.setHeader('Content-Disposition', 'attachment; filename="shrineflow-audit-events.json"');
        return response.json({ exportedAt: new Date().toISOString(), events });
      }
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="shrineflow-audit-events.csv"');
      return response.send(auditEventsCsv(events));
    } catch (error) {
      return sendError(response, error);
    }
  });

  return router;
}
