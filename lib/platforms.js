import { getPlatformAccounts } from './platform-accounts.js';
import { getPlatformCapabilities } from './capabilities.js';

export const PLATFORM_DEFINITIONS = [
  {
    id: 'facebook',
    name: 'Facebook 粉專',
    shortName: 'Facebook',
    canPublish: true,
    previewKind: 'feed',
    description: '標準粉專貼文、Reel 與限時動態。排程交粉專原生佇列（關機仍會到點公開）。',
    contentTypes: [
      {
        id: 'post',
        name: '貼文',
        canPublish: true,
        description: '一般動態：文字、多張圖或單支影片。多張圖會以相簿／輪播送出；圖＋影混合暫不支援。影片請用常見 mp4。可交粉專原生排程。',
        settings: [],
      },
      {
        id: 'reel',
        name: 'Reel',
        canPublish: true,
        description: '直式短影音。請用 9:16、約 3–90 秒、常見 mp4（H.264）；比例／長度不對時平台可能拒發。需一支影片；文案寫在 Reel 欄。可原生排程。',
        settings: [],
      },
      {
        id: 'story',
        name: '限時動態',
        canPublish: true,
        description: '24 小時限時。一次一張圖或一支影片（影片建議 ≤ 60 秒）。不支援原生排程，只能立刻發。',
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
    description: '貼文／Reel／限時。有圖影時需設定公開媒體網址；排程為本機到點發（服務需開著）。',
    contentTypes: [
      {
        id: 'feed',
        name: '貼文',
        canPublish: false,
        description: '單圖自動單張、多張圖自動輪播。建議清晰 JPG／PNG；有媒體需設定公開媒體網址（Meta 要抓得到）。輪播請勿混入影片。排程＝本機到期真發。',
        settings: [],
      },
      {
        id: 'reel',
        name: 'Reel',
        canPublish: false,
        description: '短影音。請用 9:16、約 3–90 秒、常見 mp4；規格不符 Meta 可能拒發。有媒體需 PUBLIC_MEDIA_BASE_URL。排程＝本機到期真發。',
        settings: [],
      },
      {
        id: 'story',
        name: '限時動態',
        canPublish: false,
        description: '一次一張圖或一支影片（影片建議直式、≤ 60 秒）。有媒體需 PUBLIC_MEDIA_BASE_URL；排程＝本機到期真發。',
        settings: [{ id: 'link', name: '連結', type: 'text', placeholder: '選填' }],
      },
    ],
  },
  {
    id: 'threads',
    name: 'Threads',
    shortName: 'Threads',
    canPublish: false,
    previewKind: 'threads',
    description: '文字為主，可附圖／影。有媒體需公開媒體網址；排程為本機到點發。',
    contentTypes: [{
      id: 'post',
      name: '貼文',
      canPublish: false,
      description: '文字優先（注意字數上限）；可附單圖或單影。純文字不需公開媒體網址；有媒體則要。影片處理較久，失敗可稍後再試。',
      settings: [],
    }],
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
      capabilities: getPlatformCapabilities({ platformId: platform.id, configured }),
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
