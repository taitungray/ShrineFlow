export function rejectLocalScheduleTooSoon(scheduledAt, now = new Date()) {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return '排程時間格式不正確。';
  if (at.getTime() < now.getTime() + 60 * 1000) {
    return '排程時間須至少是 1 分鐘後。';
  }
  return null;
}

export function assertLocalScheduleWindow(scheduledAt, now = new Date()) {
  const error = rejectLocalScheduleTooSoon(scheduledAt, now);
  if (error) throw new Error(error);
  return new Date(scheduledAt);
}

export function rejectScheduleContentType(platformId, contentType) {
  if (platformId === 'facebook' && contentType === 'story') {
    return 'Facebook 限時動態不支援原生排程，請改用貼文或 Reel。';
  }
  return null;
}
