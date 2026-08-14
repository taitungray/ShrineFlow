export const CAPABILITY_STATUSES = Object.freeze([
  'supported',
  'not_configured',
  'permission_required',
  'not_available',
]);

export const PLATFORM_CAPABILITY_IDS = Object.freeze([
  'publish',
  'native_schedule',
  'local_schedule',
  'story_schedule',
  'queue',
  'first_comment',
  'remote_schedule_read',
  'reel_cover',
  'crisis_pause',
]);

const PLATFORM_CAPABILITIES = Object.freeze({
  facebook: Object.freeze({
    publish: 'supported',
    native_schedule: 'supported',
    local_schedule: 'not_available',
    story_schedule: 'not_available',
    queue: 'supported',
    first_comment: 'not_available',
    remote_schedule_read: 'not_available',
    reel_cover: 'not_available',
    crisis_pause: 'not_available',
  }),
  instagram: Object.freeze({
    publish: 'supported',
    native_schedule: 'not_available',
    local_schedule: 'supported',
    story_schedule: 'supported',
    queue: 'supported',
    first_comment: 'not_available',
    remote_schedule_read: 'not_available',
    reel_cover: 'not_available',
    crisis_pause: 'not_available',
  }),
  threads: Object.freeze({
    publish: 'supported',
    native_schedule: 'not_available',
    local_schedule: 'supported',
    story_schedule: 'not_available',
    queue: 'supported',
    first_comment: 'not_available',
    remote_schedule_read: 'not_available',
    reel_cover: 'not_available',
    crisis_pause: 'not_available',
  }),
});

const SPIKE_REASONS = Object.freeze({
  first_comment: 'api_spike_required',
  remote_schedule_read: 'api_spike_required',
  reel_cover: 'api_spike_required',
  crisis_pause: 'package_not_implemented',
});

function statusEntry(status, reason = '') {
  return {
    status: CAPABILITY_STATUSES.includes(status) ? status : 'not_available',
    ...(reason ? { reason } : {}),
  };
}

function normalizeOverride(value) {
  if (typeof value === 'string') return statusEntry(value);
  if (!value || typeof value !== 'object') return null;
  return statusEntry(value.status, String(value.reason || '').trim());
}

export function getPlatformCapabilities(account = {}) {
  const platformId = String(account.platformId || '').trim();
  const configured = Boolean(account.configured);
  const defaults = PLATFORM_CAPABILITIES[platformId] || {};
  const overrides = account.capabilities && typeof account.capabilities === 'object'
    ? account.capabilities
    : {};

  return Object.fromEntries(PLATFORM_CAPABILITY_IDS.map((capabilityId) => {
    const override = normalizeOverride(overrides[capabilityId]);
    if (override) return [capabilityId, override];
    if (!configured) return [capabilityId, statusEntry('not_configured', 'account_not_configured')];
    const status = defaults[capabilityId] || 'not_available';
    return [capabilityId, statusEntry(status, status === 'not_available' ? (SPIKE_REASONS[capabilityId] || 'platform_not_supported') : '')];
  }));
}

export function getCapability(account = {}, capabilityId = '') {
  const capabilities = getPlatformCapabilities(account);
  return capabilities[String(capabilityId || '').trim()] || statusEntry('not_available', 'unknown_capability');
}
