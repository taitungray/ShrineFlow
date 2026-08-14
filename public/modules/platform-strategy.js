import { $, escapeHtml } from './dom.js';

const STRATEGIES = {
  facebook: {
    label: 'Facebook',
    summary: '資訊完整、段落清楚，適合詳細活動、品牌故事與產業觀點。',
  },
  instagram: {
    label: 'Instagram',
    summary: '視覺先行、文字精簡；優先確認圖片質感、短影音或輪播順序。',
  },
  threads: {
    label: 'Threads',
    summary: '建議控制在 500 字內，自然像真人交流，以日常觀察、金句或問題探討開啟互動。',
  },
};

export function renderPlatformStrategy(platformId = 'facebook') {
  const card = $('#platformStrategyCard');
  const text = $('#platformStrategyText');
  if (!card || !text) return;
  const strategy = STRATEGIES[platformId] || {
    label: platformId || '目前平台',
    summary: '請依平台受眾與內容格式檢查文案、素材及發布時間。',
  };
  card.dataset.platform = platformId;
  text.innerHTML = '<strong>' + escapeHtml(strategy.label) + ' 建議</strong>：' + escapeHtml(strategy.summary);
}
