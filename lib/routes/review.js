import { Router } from 'express';
import { getRepositories } from '../repositories.js';
import { listClientsRaw } from '../clients.js';
import { filterAccessibleClients } from '../request-scope.js';
import { assertActorPermission } from '../access-control.js';
import { currentPostVersion } from '../post-version.js';
import { addPostLifecycleEvent, isPostArchived, isPostIdea } from '../post-lifecycle.js';
import { migrateLegacyPost } from '../post-targets.js';
import { APPROVAL_STATES, normalizeApprovalState } from '../approval-workflow.js';

function routeError(message, status = 400, code = 'REVIEW_REQUEST_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function present(post, clientName = '') {
  const state = normalizeApprovalState(post);
  return {
    ...post,
    approvalState: state,
    currentVersion: currentPostVersion(post),
    clientName,
  };
}

function sendError(response, error) {
  return response.status(error.status || 400).json({
    error: error.message || '審核操作失敗。',
    code: error.code || 'REVIEW_REQUEST_INVALID',
  });
}

export function createReviewRouter({ repositories = getRepositories() } = {}) {
  const router = Router();

  router.get('/review-queue', async (request, response) => {
    try {
      const clientId = String(request.query.clientId || '').trim();
      const requestedState = String(request.query.state || 'in_review').trim();
      const states = requestedState === 'all'
        ? APPROVAL_STATES
        : [requestedState].filter((state) => APPROVAL_STATES.includes(state));
      const [posts, clients] = await Promise.all([
        repositories.posts.list(),
        listClientsRaw(repositories),
      ]);
      const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
      const normalized = posts.map((post) => migrateLegacyPost(post, post.clientId || clients[0]?.id || ''));
      const visible = filterAccessibleClients(normalized, request, clientId)
        .filter((post) => !isPostIdea(post))
        .filter((post) => states.includes(normalizeApprovalState(post)))
        .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
      response.json(visible.map((post) => present(post, clientNameById.get(post.clientId) || '')));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/posts/:postId/submit-review', async (request, response) => {
    try {
      const updated = await repositories.posts.mutate((posts) => {
        const stored = posts.find((post) => post.id === request.params.postId);
        if (!stored) throw routeError('找不到這篇內容。', 404, 'POST_NOT_FOUND');
        const post = migrateLegacyPost(stored, stored.clientId || '');
        assertActorPermission(request.actor, 'content.submit_review', post.clientId);
        if (isPostArchived(post)) throw routeError('封存內容不可送審。', 409, 'POST_ARCHIVED');
        if (isPostIdea(post)) throw routeError('Ideas 尚未轉成草稿，不能進入審核。', 409, 'IDEA_NOT_READY');
        const state = normalizeApprovalState(post);
        if (state === 'approved') throw routeError('目前版本已核准，修改後才能再次送審。', 409, 'POST_ALREADY_APPROVED');
        const now = new Date().toISOString();
        Object.assign(post, {
          approvalState: 'in_review',
          submittedBy: request.actor?.uid || null,
          submittedAt: now,
          approvedBy: null,
          approvedAt: null,
          approvedVersion: null,
          changesRequestedBy: null,
          changesRequestedAt: null,
          changeRequestNote: null,
        });
        addPostLifecycleEvent(post, 'submitted_for_review', {
          actorId: request.actor?.uid || null,
          version: currentPostVersion(post),
        }, now);
        Object.assign(stored, post);
        return present(stored);
      });
      response.json(updated);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/posts/:postId/approve', async (request, response) => {
    try {
      const updated = await repositories.posts.mutate((posts) => {
        const stored = posts.find((post) => post.id === request.params.postId);
        if (!stored) throw routeError('找不到這篇內容。', 404, 'POST_NOT_FOUND');
        const post = migrateLegacyPost(stored, stored.clientId || '');
        assertActorPermission(request.actor, 'content.approve', post.clientId);
        if (isPostArchived(post)) throw routeError('封存內容不可核准。', 409, 'POST_ARCHIVED');
        if (isPostIdea(post)) throw routeError('Ideas 尚未轉成草稿，不能進入審核。', 409, 'IDEA_NOT_READY');
        if (normalizeApprovalState(post) !== 'in_review') {
          throw routeError('只有審核中的內容可以核准。', 409, 'POST_NOT_IN_REVIEW');
        }
        const now = new Date().toISOString();
        Object.assign(post, {
          approvalState: 'approved',
          approvedBy: request.actor?.uid || null,
          approvedAt: now,
          approvedVersion: currentPostVersion(post),
          changesRequestedBy: null,
          changesRequestedAt: null,
          changeRequestNote: null,
        });
        addPostLifecycleEvent(post, 'approved', {
          actorId: request.actor?.uid || null,
          version: currentPostVersion(post),
        }, now);
        Object.assign(stored, post);
        return present(stored);
      });
      response.json(updated);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/posts/:postId/request-changes', async (request, response) => {
    try {
      const note = String(request.body?.note || '').trim().slice(0, 1000);
      const updated = await repositories.posts.mutate((posts) => {
        const stored = posts.find((post) => post.id === request.params.postId);
        if (!stored) throw routeError('找不到這篇內容。', 404, 'POST_NOT_FOUND');
        const post = migrateLegacyPost(stored, stored.clientId || '');
        assertActorPermission(request.actor, 'content.approve', post.clientId);
        if (isPostArchived(post)) throw routeError('封存內容不可退回。', 409, 'POST_ARCHIVED');
        if (isPostIdea(post)) throw routeError('Ideas 尚未轉成草稿，不能進入審核。', 409, 'IDEA_NOT_READY');
        if (normalizeApprovalState(post) !== 'in_review') {
          throw routeError('只有審核中的內容可以要求修改。', 409, 'POST_NOT_IN_REVIEW');
        }
        const now = new Date().toISOString();
        Object.assign(post, {
          approvalState: 'changes_requested',
          changesRequestedBy: request.actor?.uid || null,
          changesRequestedAt: now,
          changeRequestNote: note || null,
          approvedBy: null,
          approvedAt: null,
          approvedVersion: null,
        });
        addPostLifecycleEvent(post, 'changes_requested', {
          actorId: request.actor?.uid || null,
          note: note || null,
          version: currentPostVersion(post),
        }, now);
        Object.assign(stored, post);
        return present(stored);
      });
      response.json(updated);
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
