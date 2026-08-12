export const state = {
  generated: null,
  savedPost: null,
  posts: [],
  schedule: [],
  config: null,
  uploadPreviewUrls: [],
  selectedMediaItems: [],
  mediaDragIndex: null,
  selectedPlatform: 'facebook',
  platforms: [],
  accounts: [],
};

export const DEFAULT_HASHTAGS = ['#神像彩繪', '#宮廟藝術', '#傳統工藝', '#台灣信仰'];

export const PLATFORM_NAMES = {
  facebook: 'Facebook 粉專',
  instagram: 'Instagram',
  threads: 'Threads',
  line: 'LINE VOOM',
};

export const PLATFORM_DESCRIPTIONS = {
  facebook: '標準粉專貼文，支援多張圖片與單支影片。',
  instagram: '以圖片／影片為主，搭配 caption 與 Hashtag。',
  threads: '文字優先的貼文，可附加圖片。',
  line: '適合訊息較短、搭配直式素材的動態貼文。',
};

export function mediaPathsOf(record = {}) {
  if (Array.isArray(record.mediaPaths) && record.mediaPaths.length) return record.mediaPaths;
  return record.imagePath ? [record.imagePath] : [];
}
