import test from 'node:test';
import assert from 'node:assert/strict';
import { getCapability, getPlatformCapabilities } from '../lib/capabilities.js';

test('returns not_configured capabilities for an unconfigured account', () => {
  const capabilities = getPlatformCapabilities({ platformId: 'instagram', configured: false });
  assert.equal(capabilities.publish.status, 'not_configured');
  assert.equal(capabilities.publish.reason, 'account_not_configured');
  assert.equal(capabilities.story_schedule.status, 'not_configured');
});

test('exposes platform-specific schedule capabilities', () => {
  const facebook = getPlatformCapabilities({ platformId: 'facebook', configured: true });
  const instagram = getPlatformCapabilities({ platformId: 'instagram', configured: true });
  const threads = getPlatformCapabilities({ platformId: 'threads', configured: true });

  assert.equal(facebook.native_schedule.status, 'supported');
  assert.equal(facebook.local_schedule.status, 'not_available');
  assert.equal(instagram.local_schedule.status, 'supported');
  assert.equal(instagram.story_schedule.status, 'supported');
  assert.equal(threads.story_schedule.status, 'not_available');
});

test('keeps unverified capabilities explicitly unavailable', () => {
  const capabilities = getPlatformCapabilities({ platformId: 'instagram', configured: true });
  assert.deepEqual(capabilities.first_comment, {
    status: 'not_available',
    reason: 'api_spike_required',
  });
  assert.deepEqual(getCapability({ platformId: 'facebook', configured: true }, 'remote_schedule_read'), {
    status: 'not_available',
    reason: 'api_spike_required',
  });
});

test('allows an explicit capability result from a verified connector', () => {
  const capabilities = getPlatformCapabilities({
    platformId: 'instagram',
    configured: true,
    capabilities: {
      first_comment: { status: 'permission_required', reason: 'instagram_manage_comments' },
    },
  });
  assert.deepEqual(capabilities.first_comment, {
    status: 'permission_required',
    reason: 'instagram_manage_comments',
  });
});
