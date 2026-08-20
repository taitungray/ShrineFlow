import {
  AuthorizationError,
  accessibleClientIds,
  actorMembership,
  actorHasAnyPermission,
  assertActorPermission,
} from './access-control.js';
import { appendAuditEvent } from './audit-log.js';
import { createSecurityMonitor } from './security-events.js';

function apiPath(request) {
  const value = String(request.path || request.url || '').split('?')[0];
  return value.startsWith('/api/') ? value.slice(4) : value;
}

function requestedClientId(request) {
  return String(
    request.params?.clientId
    || request.body?.clientId
    || request.query?.clientId
    || '',
  ).trim();
}

const HIGH_RISK_PERMISSIONS = new Set([
  'system.manage',
  'member.manage',
  'account.manage',
]);

function requiresRecentReauth(request, rule) {
  return ['POST', 'PATCH', 'DELETE'].includes(String(request.method || '').toUpperCase())
    && HIGH_RISK_PERMISSIONS.has(rule.permission);
}

function notFound(resourceType) {
  return new AuthorizationError(`${resourceType} not found.`, {
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
  });
}

async function resourceScope(request, repositories, resourceType, resourceId) {
  let record = null;
  if (resourceType === 'post') record = await repositories.posts.getById(resourceId);
  if (resourceType === 'template') record = await repositories.templates.getById(resourceId);
  if (resourceType === 'savedReply') record = await repositories.savedReplies.getById(resourceId);
  if (resourceType === 'campaign') record = await repositories.campaigns.getById(resourceId);
  if (resourceType === 'media') record = await repositories.mediaAssets.getById(resourceId);
  if (resourceType === 'scheduleTarget') {
    const posts = await repositories.posts.list();
    record = posts.find((post) => (post.targets || []).some((target) => target.id === resourceId)) || null;
  }
  if (resourceType === 'notification') {
    const notifications = await repositories.notifications.list();
    record = notifications?.items?.find((item) => item.id === resourceId) || null;
  }
  if (!record?.clientId) throw notFound(resourceType);
  return { clientId: record.clientId, resourceId, resourceType };
}

function matchId(path, pattern) {
  return path.match(pattern)?.[1] || '';
}

function ruleFor(request) {
  const path = apiPath(request);
  const method = String(request.method || 'GET').toUpperCase();
  let id = '';

  if (path === '/webhooks/meta' || path.startsWith('/auth/') || path === '/me' || path === '/healthz') {
    return { skip: true };
  }

  if (path === '/config' && method === 'GET') return { permission: 'content.view', mode: 'any' };
  if (path === '/accounts' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/facebook/status' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };

  if (path === '/clients' && method === 'GET') return { permission: 'content.view', mode: 'any' };
  if (path === '/clients' && method === 'POST') return {
    permission: 'system.manage', mode: 'system', action: 'client.created', resourceType: 'client',
  };
  if ((id = matchId(path, /^\/clients\/([^/]+)\/workflow$/))) {
    return {
      permission: 'member.manage', mode: 'client', clientId: id,
      action: method === 'PATCH' ? 'client.workflow_updated' : '',
      resourceType: 'client', resourceId: id,
    };
  }
  if ((id = matchId(path, /^\/clients\/([^/]+)\/members(?:\/[^/]+)?$/))) {
    return {
      permission: 'member.manage', mode: 'client', clientId: id,
      resourceType: 'membership', resourceId: matchId(path, /\/members\/([^/]+)$/),
    };
  }
  if ((id = matchId(path, /^\/clients\/([^/]+)(?:\/accounts(?:\/[^/]+\/test)?)?$/))) {
    return {
      permission: 'account.manage', mode: 'client', clientId: id,
      action: method === 'PATCH' ? 'client.updated' : 'platform_account.updated',
      resourceType: path.includes('/accounts') ? 'platformAccount' : 'client',
      resourceId: id,
    };
  }

  if (path.startsWith('/settings')) {
    let action = '';
    if (method !== 'GET') {
      if (path.includes('rotate-secrets')) action = 'system.secrets_rotated';
      else if (path.includes('test-gemini')) action = 'system.gemini_tested';
      else if (path.includes('test-facebook')) action = 'system.facebook_tested';
      else action = 'system.settings_updated';
    }
    return {
      permission: 'system.manage', mode: 'system',
      action, resourceType: 'settings',
    };
  }
  if (path === '/invitations' || /^\/invitations\/[^/]+\/revoke$/.test(path)) {
    return { permission: 'member.manage', mode: 'any', resourceType: 'invitation' };
  }
  if (/^\/users\/[^/]+$/.test(path)) return {
    permission: 'system.manage', mode: 'system', resourceType: 'user',
  };
  if (path === '/audit-events' && method === 'GET') return {
    permission: 'audit.view', mode: 'optionalClient', resourceType: 'auditEvent',
  };
  if (path === '/audit-events/export' && method === 'GET') return {
    permission: 'audit.view', mode: 'optionalClient', resourceType: 'auditExport',
  };
  if (path === '/system/notifications' && method === 'GET') {
    return { permission: 'content.view', mode: 'optionalClient' };
  }
  if ((id = matchId(path, /^\/system\/notifications\/([^/]+)\/read$/))) {
    return {
      permission: 'content.view', mode: 'resource', resourceType: 'notification', resourceId: id,
      action: 'notification.read',
    };
  }
  if (path === '/system/client-errors' && method === 'POST') {
    return { permission: 'content.view', mode: 'any', resourceType: 'system' };
  }
  if (path.startsWith('/system/')) return {
    permission: 'system.manage', mode: 'system',
    action: method === 'GET' ? '' : `system.${path.slice('/system/'.length).replaceAll('/', '_')}`,
    resourceType: 'system',
  };

  if (path === '/gods') return {
    permission: method === 'GET' ? 'content.view' : 'system.manage',
    mode: method === 'GET' ? 'any' : 'system',
    action: method === 'GET' ? '' : 'presets.updated', resourceType: 'presets',
  };

  if (path === '/templates') return {
    permission: method === 'GET' ? 'content.view' : 'template.manage',
    mode: 'optionalClient',
    action: method === 'POST' ? 'template.created' : '', resourceType: 'template',
  };
  if ((id = matchId(path, /^\/templates\/([^/]+)$/))) return {
    permission: 'template.manage', mode: 'resource', resourceType: 'template', resourceId: id,
    action: method === 'DELETE' ? 'template.deleted' : 'template.updated',
  };

  if (path === '/campaigns') return {
    permission: method === 'GET' ? 'content.view' : 'campaign.manage',
    mode: 'optionalClient',
    action: method === 'POST' ? 'campaign.created' : '', resourceType: 'campaign',
  };
  if ((id = matchId(path, /^\/campaigns\/([^/]+)$/))) return {
    permission: 'campaign.manage', mode: 'resource', resourceType: 'campaign', resourceId: id,
    action: method === 'DELETE' ? 'campaign.deleted' : 'campaign.updated',
  };

  if (path === '/media' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/media/upload-session' && method === 'POST') return {
    permission: 'media.manage', mode: 'client', action: 'media.upload_started', resourceType: 'media',
  };
  if (path === '/media/finalize' && method === 'POST') return {
    permission: 'media.manage', mode: 'resource', resourceType: 'media',
    resourceId: String(request.body?.mediaId || ''), action: 'media.finalized',
  };
  if (path === '/media/preview' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if ((id = matchId(path, /^\/media\/([^/]+)\/view-url$/))) return {
    permission: 'content.view', mode: 'resource', resourceType: 'media', resourceId: id,
  };
  if ((id = matchId(path, /^\/media\/([^/]+)$/))) return {
    permission: 'media.manage', mode: 'resource', resourceType: 'media', resourceId: id,
    action: 'media.deleted',
  };

  if (path === '/remote-schedule' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/inbox' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/bulk-import/preview' && method === 'POST') return {
    permission: 'content.create', mode: 'optionalClient', action: 'bulk_import.preview', resourceType: 'bulkImport',
  };
  if (path === '/bulk-import/commit' && method === 'POST') return {
    permission: 'content.create', mode: 'optionalClient', action: 'bulk_import.committed', resourceType: 'bulkImport',
  };
  if (path === '/bulk-import/schedule' && method === 'POST') return {
    permission: 'schedule.manage', mode: 'optionalClient', action: 'bulk_import.scheduled', resourceType: 'bulkImport',
  };
  if (path === '/review-queue' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path.startsWith('/inbox/items/')) return {
    permission: 'inbox.reply', mode: 'client',
    action: method === 'POST' ? 'inbox.replied' : 'inbox.metadata_updated', resourceType: 'inboxItem',
    resourceId: matchId(path, /^\/inbox\/items\/([^/]+)/),
  };

  if (path === '/saved-replies' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/saved-replies' && method === 'POST') return {
    permission: 'template.manage', mode: 'optionalClient', action: 'saved_reply.created', resourceType: 'savedReply',
  };
  if ((id = matchId(path, /^\/saved-replies\/([^/]+)$/))) return {
    permission: 'template.manage', mode: 'resource', resourceType: 'savedReply', resourceId: id,
    action: method === 'DELETE' ? 'saved_reply.deleted' : 'saved_reply.updated',
  };

  if (path === '/posts') return {
    permission: method === 'GET' ? 'content.view' : 'content.create',
    mode: 'optionalClient', action: method === 'POST' ? 'post.created' : '', resourceType: 'post',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/submit-review$/))) return {
    permission: 'content.submit_review', mode: 'resource', resourceType: 'post', resourceId: id,
    action: 'post.review_submitted',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/approve$/))) return {
    permission: 'content.approve', mode: 'resource', resourceType: 'post', resourceId: id,
    action: 'post.approved',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/request-changes$/))) return {
    permission: 'content.approve', mode: 'resource', resourceType: 'post', resourceId: id,
    action: 'post.changes_requested',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/archive$/))) return {
    permission: 'content.archive', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.archived',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/duplicate$/))) return {
    permission: 'content.create', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.duplicated',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/repurpose$/))) return {
    permission: 'content.create', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.repurposed',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/evergreen$/))) return {
    permission: method === 'GET' ? 'content.view' : 'schedule.manage', mode: 'resource', resourceType: 'post', resourceId: id,
    action: method === 'GET' ? '' : (method === 'DELETE' ? 'evergreen.disabled' : 'evergreen.updated'),
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/restore$/))) return {
    permission: 'content.edit', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.restored',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/hide$/))) return {
    permission: 'content.edit', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.hidden',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/unhide$/))) return {
    permission: 'content.edit', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.unhidden',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/versions(?:\/[^/]+\/restore)?$/))) return {
    permission: method === 'GET' ? 'content.view' : 'content.edit',
    mode: 'resource', resourceType: 'post', resourceId: id,
    action: method === 'GET' ? '' : (path.endsWith('/restore') ? 'post.version_restored' : 'post.version_created'),
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/validate$/))) return {
    permission: 'content.view', mode: 'resource', resourceType: 'post', resourceId: id,
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)$/))) return {
    permission: method === 'GET' ? 'content.view' : 'content.edit',
    mode: 'resource', resourceType: 'post', resourceId: id,
    action: method === 'GET' ? '' : 'post.updated',
  };

  if (path === '/schedule' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/schedule' && method === 'POST') return {
    permission: 'schedule.manage', mode: 'resource', resourceType: 'post',
    resourceId: String(request.body?.postId || ''), action: 'schedule.created',
  };
  if ((id = matchId(path, /^\/schedule\/([^/]+)$/))) return {
    permission: 'schedule.manage', mode: 'resource', resourceType: 'scheduleTarget', resourceId: id,
    action: method === 'DELETE' ? 'schedule.deleted' : 'schedule.updated',
  };
  if (path === '/queues' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/queues' && ['PUT', 'PATCH'].includes(method)) return {
    permission: 'schedule.manage', mode: 'client', action: 'queue.updated', resourceType: 'queue',
  };
  if (path === '/crisis-pause' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/crisis-pause' && method === 'POST') return {
    permission: 'schedule.manage', mode: 'client', action: 'crisis_pause.started', resourceType: 'crisisPause',
  };
  if (path === '/crisis-pause/resume' && method === 'POST') return {
    permission: 'schedule.manage', mode: 'client', action: 'crisis_pause.resumed', resourceType: 'crisisPause',
  };

  if (path === '/publish/target/first-comment') return {
    permission: 'publish.execute', mode: 'resource', resourceType: 'post',
    resourceId: String(request.body?.postId || ''), action: 'publish.first_comment',
  };
  if (path === '/publish/target' || path === '/publish/facebook') return {
    permission: 'publish.execute', mode: 'resource', resourceType: 'post',
    resourceId: String(request.body?.postId || ''), action: 'publish.executed',
  };
  if (path === '/generate') return {
    permission: 'content.create', mode: 'any', action: 'ai.generated', resourceType: 'content',
  };
  if (/^\/generate\/jobs\/[^/]+$/.test(path) && method === 'GET') return {
    permission: 'content.create', mode: 'any', resourceType: 'content',
  };
  if (path === '/rewrite') return {
    permission: 'content.edit', mode: 'optionalClient', action: 'ai.rewritten', resourceType: 'content',
  };
  if (/^\/rewrite\/jobs\/[^/]+$/.test(path) && method === 'GET') return {
    permission: 'content.edit', mode: 'optionalClient', resourceType: 'content',
  };

  return null;
}

function attachAudit(request, response, rule, repositories) {
  if (!rule.action || typeof response.once !== 'function') return;
  response.once('finish', () => {
    if (response.statusCode >= 400) return;
    appendAuditEvent({
      actor: request.actor,
      clientId: request.authorizedClientId,
      action: rule.action,
      resourceType: rule.resourceType,
      resourceId: rule.resourceId,
      requestId: request.get?.('X-Request-Id') || '',
      metadata: { method: request.method, path: apiPath(request), status: response.statusCode },
      ip: request.ip,
      userAgent: request.get?.('User-Agent') || '',
    }, repositories).catch(() => {});
  });
}

export function createApiAuthorizationMiddleware({
  repositories,
  reauthService = null,
  securityMonitor = repositories ? createSecurityMonitor({ repositories }) : null,
} = {}) {
  if (!repositories) throw new Error('Authorization middleware requires repositories.');
  return async (request, response, next) => {
    const rule = ruleFor(request);
    if (rule?.skip) return next();
    if (!rule) {
      return response.status(403).json({
        error: '你沒有執行此操作的權限。',
        code: 'PERMISSION_DENIED',
      });
    }
    try {
      request.accessibleClientIds = accessibleClientIds(request.actor, 'content.view');
      let clientId = rule.clientId || '';
      if (rule.mode === 'resource') {
        const resource = await resourceScope(request, repositories, rule.resourceType, rule.resourceId);
        clientId = resource.clientId;
      } else if (rule.mode === 'client' || rule.mode === 'optionalClient') {
        clientId = clientId || requestedClientId(request);
      }

      if (clientId) {
        try {
          request.membership = assertActorPermission(request.actor, rule.permission, clientId);
        } catch (error) {
          if (rule.mode === 'resource' && !actorMembership(request.actor, clientId)) throw notFound(rule.resourceType);
          throw error;
        }
        request.authorizedClientId = clientId;
      } else if (!actorHasAnyPermission(request.actor, rule.permission)) {
        throw new AuthorizationError();
      }

      if (reauthService?.required && requiresRecentReauth(request, rule)) {
        reauthService.assertRequest(request, request.actor);
      }
      attachAudit(request, response, rule, repositories);
      return next();
    } catch (error) {
      const securityEvent = securityMonitor?.record?.({
        type: 'permission_denied',
        actor: request.actor,
        clientId: request.authorizedClientId || requestedClientId(request),
        resourceType: rule.resourceType,
        resourceId: rule.resourceId,
        requestId: request.get?.('X-Request-Id') || '',
        metadata: { method: request.method, path: apiPath(request), code: error.code || 'PERMISSION_DENIED' },
        ip: request.ip,
        userAgent: request.get?.('User-Agent') || '',
      });
      securityEvent?.catch?.(() => {});
      return response.status(error.status || 403).json({
        error: error.message || 'Permission denied.',
        code: error.code || 'PERMISSION_DENIED',
      });
    }
  };
}

export { ruleFor as resolveApiAuthorizationRule };
