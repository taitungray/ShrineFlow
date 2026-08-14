import { currentPostVersion } from './post-version.js';

export const APPROVAL_STATES = Object.freeze([
  'draft',
  'in_review',
  'approved',
  'changes_requested',
]);

export function normalizeApprovalState(post = {}) {
  const state = String(post.approvalState || '').trim();
  if (!APPROVAL_STATES.includes(state)) return 'draft';
  if (state === 'approved' && Number(post.approvedVersion) !== currentPostVersion(post)) return 'draft';
  return state;
}

export function approvalIsCurrent(post = {}) {
  return normalizeApprovalState(post) === 'approved'
    && Number(post.approvedVersion) === currentPostVersion(post);
}

export function approvalGate(post = {}, client = {}) {
  const required = Boolean(client?.approvalRequired);
  if (!required) return { required: false, allowed: true, state: normalizeApprovalState(post) };
  if (approvalIsCurrent(post)) {
    return {
      required: true,
      allowed: true,
      state: 'approved',
      approvedVersion: Number(post.approvedVersion),
    };
  }
  return {
    required: true,
    allowed: false,
    state: normalizeApprovalState(post),
    code: 'APPROVAL_REQUIRED',
    message: '此品牌已啟用審核，請先取得目前版本的核准。',
  };
}

export function invalidateApproval(post = {}, actor = {}, occurredAt = new Date().toISOString()) {
  Object.assign(post, {
    approvalState: 'draft',
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    approvedVersion: null,
    changesRequestedBy: null,
    changesRequestedAt: null,
    changeRequestNote: null,
    approvalInvalidatedAt: occurredAt,
    approvalInvalidatedBy: actor?.uid || actor?.email || null,
  });
  return post;
}
