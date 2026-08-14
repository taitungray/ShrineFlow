export const state = {
  generated: null,
  savedPost: null,
  editorDirty: false,
  posts: [],
  schedule: [],
  templates: [],
  campaigns: [],
  config: null,
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
};

export const DEFAULT_HASHTAGS = ['#品牌內容', '#社群經營', '#內容行銷'];

export const PLATFORM_NAMES = {
  facebook: 'Facebook 粉專',
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
  return record.imagePath ? [record.imagePath] : [];
}

export function currentClient() {
  return state.clients.find((client) => client.id === state.currentClientId) || state.clients[0] || null;
}

export function setCurrentClientId(clientId) {
  state.currentClientId = clientId || '';
  if (clientId) localStorage.setItem('shrineflow.currentClientId', clientId);
}

export function clientQuery(path) {
  const clientId = state.currentClientId;
  if (!clientId) return path;
  const join = path.includes('?') ? '&' : '?';
  return path + join + 'clientId=' + encodeURIComponent(clientId);
}
