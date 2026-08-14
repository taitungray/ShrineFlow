import {
  AuthorizationError,
  accessibleClientIds,
  actorMembership,
  actorHasAnyPermission,
  assertActorPermission,
} from './access-control.js';
import { appendAuditEvent } from './audit-log.js';

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

  if (path === '/webhooks/meta' || path.startsWith('/auth/') || path === '/me') return null;

  if (path === '/config' && method === 'GET') return { permission: 'content.view', mode: 'any' };
  if (path === '/accounts' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/facebook/status' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };

  if (path === '/clients' && method === 'GET') return { permission: 'content.view', mode: 'any' };
  if (path === '/clients' && method === 'POST') return {
    permission: 'system.manage', mode: 'system', action: 'client.created', resourceType: 'client',
  };
  if ((id = matchId(path, /^\/clients\/([^/]+)(?:\/accounts(?:\/[^/]+\/test)?)?$/))) {
    return {
      permission: 'account.manage', mode: 'client', clientId: id,
      action: method === 'PATCH' ? 'client.updated' : 'platform_account.updated',
      resourceType: path.includes('/accounts') ? 'platformAccount' : 'client',
      resourceId: id,
    };
  }

  if (path.startsWith('/settings')) return {
    permission: 'system.manage', mode: 'system',
    action: method === 'GET' ? '' : 'system.settings_updated', resourceType: 'settings',
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
  if ((id = matchId(path, /^\/media\/([^/]+)\/view-url$/))) return {
    permission: 'content.view', mode: 'resource', resourceType: 'media', resourceId: id,
  };
  if ((id = matchId(path, /^\/media\/([^/]+)$/))) return {
    permission: 'media.manage', mode: 'resource', resourceType: 'media', resourceId: id,
    action: 'media.deleted',
  };

  if (path === '/insights' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path === '/inbox' && method === 'GET') return { permission: 'content.view', mode: 'optionalClient' };
  if (path.startsWith('/inbox/items/')) return {
    permission: 'inbox.reply', mode: 'client',
    action: method === 'POST' ? 'inbox.replied' : 'inbox.metadata_updated', resourceType: 'inboxItem',
    resourceId: matchId(path, /^\/inbox\/items\/([^/]+)/),
  };

  if (path === '/posts') return {
    permission: method === 'GET' ? 'content.view' : 'content.create',
    mode: 'optionalClient', action: method === 'POST' ? 'post.created' : '', resourceType: 'post',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/archive$/))) return {
    permission: 'content.archive', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.archived',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/duplicate$/))) return {
    permission: 'content.create', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.duplicated',
  };
  if ((id = matchId(path, /^\/posts\/([^/]+)\/restore$/))) return {
    permission: 'content.edit', mode: 'resource', resourceType: 'post', resourceId: id, action: 'post.restored',
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

  if (path === '/publish/target' || path === '/publish/facebook') return {
    permission: 'publish.execute', mode: 'resource', resourceType: 'post',
    resourceId: String(request.body?.postId || ''), action: 'publish.executed',
  };
  if (path === '/generate') return {
    permission: 'content.create', mode: 'any', action: 'ai.generated', resourceType: 'content',
  };
  if (path === '/rewrite') return {
    permission: 'content.edit', mode: 'optionalClient', action: 'ai.rewritten', resourceType: 'content',
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

export function createApiAuthorizationMiddleware({ repositories } = {}) {
  if (!repositories) throw new Error('Authorization middleware requires repositories.');
  return async (request, response, next) => {
    const rule = ruleFor(request);
    if (!rule) return next();
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

      attachAudit(request, response, rule, repositories);
      return next();
    } catch (error) {
      return response.status(error.status || 403).json({
        error: error.message || 'Permission denied.',
        code: error.code || 'PERMISSION_DENIED',
      });
    }
  };
}

export { ruleFor as resolveApiAuthorizationRule };
