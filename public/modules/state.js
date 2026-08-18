export const state = {
  generated: null,
  savedPost: null,
  editorDirty: false,
  autosaveTimer: null,
  autosaveRetryTimer: null,
  autosaveInFlight: false,
  autosavePromise: null,
  autosaveIntent: 0,
  autosaveState: 'idle',
  posts: [],
  schedule: [],
  queueSettings: null,
  remoteSchedule: null,
  templates: [],
  campaigns: [],
  insights: null,
  insightsScope: 'account',
  repurposeCandidates: null,
  bulkImportPreview: null,
  bulkImportDrafts: [],
  bestTimes: null,
  inbox: null,
  inboxFilter: 'all',
  savedReplies: [],
  crisisPause: null,
  notifications: [],
  reviewQueue: [],
  config: null,
  facebookStatus: { connected: false, configured: false, error: '' },
  clients: [],
  currentClientId: localStorage.getItem('shrineflow.currentClientId') || '',
  activeTargetId: '',
  selectedTargetAccountIds: [],
  uploadPreviewUrls: [],
  selectedMediaItems: [],
  mediaDragIndex: null,
  selectedPlatform: 'facebook',
  platforms: [],
  accounts: [],
  actor: null,
};

export const DEFAULT_HASHTAGS = [];

export const PLATFORM_NAMES = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
};

export const PLATFORM_DESCRIPTIONS = {
  facebook: '標準粉專貼文，支援多張圖片與單支影片。',
  instagram: '以圖片／影片為主，搭配 caption 與 Hashtag。',
  threads: '文字優先的貼文，可附加圖片。',
};

export function mediaPathsOf(record = {}) {
  if (Array.isArray(record.mediaPaths) && record.mediaPaths.length) return record.mediaPaths;
  if (record.imagePath) return [record.imagePath];
  const fromTargets = [];
  for (const target of record.targets || []) {
    if (Array.isArray(target?.mediaPaths) && target.mediaPaths.length) {
      fromTargets.push(...target.mediaPaths);
    }
  }
  return fromTargets;
}

export function currentClient() {
  return state.clients.find((client) => client.id === state.currentClientId) || state.clients[0] || null;
}

export function currentMembership() {
  return (state.actor?.memberships || []).find((membership) => (
    membership.clientId === state.currentClientId && membership.status === 'active'
  )) || null;
}

export function hasPermission(permission) {
  if (state.actor?.legacy) return true;
  if (state.actor?.systemRole === 'owner') return true;
  return Boolean(currentMembership()?.permissions?.includes(permission));
}

export function setCurrentClientId(clientId) {
  state.currentClientId = clientId || '';
  if (clientId) localStorage.setItem('shrineflow.currentClientId', clientId);
  else localStorage.removeItem('shrineflow.currentClientId');
}

export function clientQuery(path) {
  const clientId = state.currentClientId;
  if (!clientId) return path;
  const join = path.includes('?') ? '&' : '?';
  return path + join + 'clientId=' + encodeURIComponent(clientId);
}
