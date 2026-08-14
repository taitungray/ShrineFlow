import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvalGate,
  approvalIsCurrent,
  invalidateApproval,
  normalizeApprovalState,
} from '../lib/approval-workflow.js';

test('approval gate keeps existing brands on the fast path', () => {
  const post = { version: 2, approvalState: 'draft' };
  assert.deepEqual(approvalGate(post, { approvalRequired: false }), {
    required: false,
    allowed: true,
    state: 'draft',
  });
});

test('approval gate requires the current approved version when enabled', () => {
  const post = {
    version: 4,
    approvalState: 'approved',
    approvedVersion: 4,
  };
  assert.equal(approvalIsCurrent(post), true);
  assert.equal(approvalGate(post, { approvalRequired: true }).allowed, true);
  post.version = 5;
  assert.equal(normalizeApprovalState(post), 'draft');
  assert.equal(approvalGate(post, { approvalRequired: true }).code, 'APPROVAL_REQUIRED');
});

test('editing invalidates approval provenance', () => {
  const post = {
    version: 3,
    approvalState: 'approved',
    approvedVersion: 3,
    approvedBy: 'reviewer-1',
    approvedAt: '2026-08-14T00:00:00.000Z',
  };
  invalidateApproval(post, { uid: 'editor-1' }, '2026-08-14T01:00:00.000Z');
  assert.equal(post.approvalState, 'draft');
  assert.equal(post.approvedVersion, null);
  assert.equal(post.approvedBy, null);
  assert.equal(post.approvalInvalidatedBy, 'editor-1');
});
