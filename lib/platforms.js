import { getPlatformAccounts } from './platform-accounts.js';

export const PLATFORM_DEFINITIONS = [
  {
    id: 'facebook',
    name: 'Facebook 粉專',
    shortName: 'Facebook',
    canPublish: true,
    previewKind: 'feed',
    description: '標準粉專貼文、Reel 與限時動態。',
    contentTypes: [
      {
        id: 'post',
        name: '貼文',
        canPublish: true,
        description: '一般動態貼文，可搭配文字、多張圖片或單支影片。',
        settings: [
          { id: 'layout', name: '媒體排列', type: 'select', options: [{ value: 'auto', label: '自動' }, { value: 'carousel', label: '多圖輪播' }] },
        ],
      },
      {
        id: 'reel',
        name: 'Reel',
        canPublish: true,
        description: '直式短影音（建議 9:16、3–90 秒）。需上傳一支影片；文案寫在 Reel 欄。',
        settings: [],
      },
      {
        id: 'story',
        name: '限時動態',
        canPublish: true,
        description: '24 小時限時內容。一次一張圖或一支影片（影片建議 ≤ 60 秒）。',
        settings: [],
      },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    shortName: 'Instagram',
    canPublish: false,
    previewKind: 'instagram',
    description: '以圖片／影片為主，搭配 caption 與 Hashtag。',
    contentTypes: [
      { id: 'feed', name: '貼文', canPublish: false, description: 'Instagram 貼文／輪播。', settings: [{ id: 'layout', name: '媒體排列', type: 'select', options: [{ value: 'single', label: '單張' }, { value: 'carousel', label: '輪播' }] }] },
      { id: 'reel', name: 'Reel', canPublish: false, description: 'Instagram 短影音。', settings: [] },
      { id: 'story', name: '限時動態', canPublish: false, description: 'Instagram 限時動態。', settings: [{ id: 'link', name: '連結', type: 'text', placeholder: '選填' }] },
    ],
  },
  {
    id: 'threads',
    name: 'Threads',
    shortName: 'Threads',
    canPublish: false,
    previewKind: 'threads',
    description: '文字優先的貼文，可附加圖片。',
    contentTypes: [{ id: 'post', name: '貼文', canPublish: false, description: '文字貼文，可附加圖片。', settings: [] }],
  },
];

export function getPublishingPlatforms(facebookConfiguredOrOpts = false) {
  const opts = typeof facebookConfiguredOrOpts === 'boolean'
    ? { facebookConfigured: facebookConfiguredOrOpts }
    : (facebookConfiguredOrOpts || {});
  const {
    facebookConfigured = false,
    instagramConfigured = false,
    threadsConfigured = false,
  } = opts;

  return PLATFORM_DEFINITIONS.map((platform) => {
    const configured = platform.id === 'facebook' ? facebookConfigured
      : platform.id === 'instagram' ? instagramConfigured
        : platform.id === 'threads' ? threadsConfigured : false;
    return {
      ...platform,
      enabled: configured,
      configured,
      contentTypes: platform.contentTypes.map((contentType) => ({
        ...contentType,
        canPublish: platform.id === 'facebook' ? contentType.canPublish : configured,
      })),
    };
  });
}

export function buildPublishingState({
  facebookConfigured = false,
  facebookPageId = '',
  clients = [],
} = {}) {
  const hasConfiguredAccount = (platformId) => clients.some((client) => (
    (client.accounts || []).some((account) => (
      account.platformId === platformId
      && account.credentials?.userId
      && account.credentials?.accessToken
    ))
  ));
  const instagramConfigured = hasConfiguredAccount('instagram');
  const threadsConfigured = hasConfiguredAccount('threads');

  return {
    platforms: getPublishingPlatforms({
      facebookConfigured,
      instagramConfigured,
      threadsConfigured,
    }),
    accounts: getPlatformAccounts({
      facebookPageId,
      facebookConfigured,
      instagramConfigured,
      threadsConfigured,
    }),
  };
}

export function getPlatform(platformId) {
  return PLATFORM_DEFINITIONS.find((platform) => platform.id === platformId) || PLATFORM_DEFINITIONS[0];
}

export function getContentType(platformId, contentTypeId) {
  const platform = getPlatform(platformId);
  return platform.contentTypes.find((contentType) => contentType.id === contentTypeId) || platform.contentTypes[0];
}
