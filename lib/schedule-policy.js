export function rejectScheduleContentType(platformId, contentType) {
  if (platformId === 'facebook' && contentType === 'story') {
    return 'Facebook 限時動態不支援原生排程，請改用貼文或 Reel。';
  }
  return null;
}
