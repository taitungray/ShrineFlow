export const POST_STATUS_LABELS = {
  draft: '草稿',
  scheduled: '已排程',
  publishing: '發布中',
  published: '已發布',
  partial_success: '部分成功',
  failed: '需處理',
  archived: '已封存',
};

export const TARGET_STATUS_LABELS = {
  pending: '待發布',
  scheduled: '已排程',
  publishing: '發布中',
  retrying: '等待重試',
  published: '已發布',
  failed: '發布失敗',
  skipped_unsupported: '尚未支援',
  draft: '草稿',
};

export function postStatusLabel(status) {
  return POST_STATUS_LABELS[status] || status || POST_STATUS_LABELS.draft;
}

export function targetStatusLabel(status) {
  return TARGET_STATUS_LABELS[status] || status || TARGET_STATUS_LABELS.draft;
}

export function publishingStatusGroup(status) {
  if (['pending', 'scheduled', 'publishing'].includes(status)) return 'queue';
  if (status === 'published') return 'success';
  if (['failed', 'retrying', 'partial_success'].includes(status)) return 'attention';
  return 'other';
}

export function targetStatusSummary(targets = [], platformNames = {}) {
  if (!Array.isArray(targets) || !targets.length) return '';
  return targets.map((target) => {
    const platform = platformNames[target.platformId] || target.platformId || '未指定平台';
    return [platform, targetStatusLabel(target.status)].join('：');
  }).join(' · ');
}