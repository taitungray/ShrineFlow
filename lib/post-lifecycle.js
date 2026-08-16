import { makeId } from './store.js';

export const POST_LIFECYCLE_EVENT_LIMIT = 50;
export const CONTENT_STAGES = Object.freeze(['idea', 'draft']);

export function normalizeContentStage(value = 'draft') {
  const stage = String(value || '').trim().toLowerCase();
  return CONTENT_STAGES.includes(stage) ? stage : 'draft';
}

export function isPostIdea(post = {}) {
  return normalizeContentStage(post.contentStage) === 'idea';
}

export function addPostLifecycleEvent(post, event, metadata = {}, occurredAt = new Date().toISOString()) {
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => ![
      'token', 'accessToken', 'pageAccessToken', 'secret', 'password', 'credentials',
    ].includes(key)),
  );
  post.lifecycleEvents = [
    ...(Array.isArray(post.lifecycleEvents) ? post.lifecycleEvents : []),
    {
      id: makeId(),
      event,
      occurredAt,
      ...safeMetadata,
    },
  ].slice(-POST_LIFECYCLE_EVENT_LIMIT);
  return post;
}

export function activePostTargetStatuses(post = {}) {
  return (post.targets || [])
    .map((target) => String(target.status || 'draft'))
    .filter((status) => ['scheduled', 'pending', 'publishing', 'retrying'].includes(status));
}

export function isPostArchived(post = {}) {
  return post.status === 'archived' || Boolean(post.archivedAt);
}

export function isPostHidden(post = {}) {
  return Boolean(post.hiddenAt);
}
