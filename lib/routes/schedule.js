import { Router } from 'express';
import { readJson, mutateJson, makeId, jsonFiles } from '../store.js';
import { getContentType } from '../platforms.js';
import { findPlatformAccount } from '../platform-accounts.js';

export function createScheduleRouter({ publishingPlatforms, publishingAccounts }) {
  const router = Router();

  router.get('/schedule', async (_request, response) => {
    const schedule = await readJson(jsonFiles.schedule, []);
    response.json(schedule.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)));
  });

  router.post('/schedule', async (request, response) => {
    const { postId, scheduledAt, channel = 'facebook', accountId = '', contentType = 'post', contentSettings = {} } = request.body || {};
    if (!postId || !scheduledAt) return response.status(400).json({ error: '請選擇貼文與排程時間。' });
    const platform = publishingPlatforms.find((item) => item.id === channel);
    if (!platform) return response.status(400).json({ error: '不支援的發布平台。' });
    if (!platform.enabled) return response.status(400).json({ error: `${platform.name} 尚未串接，請先選擇已啟用的平台。` });
    const selectedContentType = getContentType(channel, contentType);
    if (!selectedContentType || selectedContentType.id !== contentType) return response.status(400).json({ error: '不支援的發布格式。' });
    if (!selectedContentType.canPublish) return response.status(400).json({ error: `${platform.name} 的「${selectedContentType.name}」尚未串接發布功能，目前先提供版型規劃。` });
    const selectedAccount = findPlatformAccount(publishingAccounts, accountId || `facebook:${process.env.FACEBOOK_PAGE_ID || 'default'}`);
    if (!selectedAccount || selectedAccount.platformId !== channel) return response.status(400).json({ error: '請選擇與發布平台相符的帳號。' });
    if (!selectedAccount.enabled) return response.status(400).json({ error: `${selectedAccount.name} 尚未連接，請先完成帳號設定。` });
    if (Number.isNaN(new Date(scheduledAt).getTime())) return response.status(400).json({ error: '排程時間格式不正確。' });
    const posts = await readJson(jsonFiles.posts, []);
    const scheduledPost = posts.find((post) => post.id === postId);
    if (!scheduledPost) return response.status(404).json({ error: '找不到要排程的貼文。' });
    const scheduledMedia = Array.isArray(scheduledPost.mediaPaths) && scheduledPost.mediaPaths.length
      ? scheduledPost.mediaPaths
      : (scheduledPost.imagePath ? [scheduledPost.imagePath] : []);
    const scheduledVideos = scheduledMedia.filter((mediaPath) => /\.(avi|m4v|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(mediaPath));
    if (scheduledVideos.length && scheduledMedia.length !== 1) {
      return response.status(400).json({ error: 'Facebook 排程支援多張圖片或單一影片，暫不支援圖片與影片混合發布。' });
    }
    const item = { id: makeId(), postId, scheduledAt, channel, accountId: selectedAccount.id, contentType, contentSettings: contentSettings && typeof contentSettings === 'object' ? contentSettings : {}, status: 'pending', createdAt: new Date().toISOString() };
    const created = await mutateJson(jsonFiles.schedule, (schedule) => {
      const duplicate = schedule.some((entry) => (
        entry.postId === postId
        && entry.channel === channel
        && entry.accountId === selectedAccount.id
        && entry.contentType === contentType
        && ['pending', 'publishing', 'retrying'].includes(entry.status)
      ));
      if (duplicate) return false;
      schedule.push(item);
      return true;
    });
    if (!created) return response.status(409).json({ error: '這篇貼文已經有相同平台與帳號的尚未完成排程。' });
    response.status(201).json(item);
  });

  return router;
}
