import { Router } from 'express';

import { directories } from '../store.js';
import { appendPostVersion } from '../post-history.js';
import { bumpPostVersion } from '../post-version.js';
import { assertCollectionCapacity } from '../storage-policy.js';
import { listClientsRaw } from '../clients.js';
import { listMediaAssets } from '../media-assets.js';
import { getRepositories } from '../repositories.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';
import { buildBulkDraft, validateBulkCsv } from '../bulk-import.js';
import { approvalGate } from '../approval-workflow.js';
import { addPostLifecycleEvent, isPostArchived, isPostIdea } from '../post-lifecycle.js';
import {
  migrateLegacyPost,
  resolveTargetCopy,
  resolveTargetMedia,
  summarizePostStatus,
} from '../post-targets.js';
import { validateTargetFormat } from '../content-validation.js';
import { rejectLocalScheduleTooSoon, rejectScheduleContentType } from '../schedule-policy.js';

export function createBulkImportRouter({
  repositories = getRepositories(),
  listClients = listClientsRaw,
  validate = validateBulkCsv,
} = {}) {
  const router = Router();

  async function validateCsvForClient(csv, clientId) {
    let mediaAssets = [];
    try {
      mediaAssets = await listMediaAssets({ clientId, includeDeleted: false }, repositories);
    } catch {
      mediaAssets = [];
    }
    return validate(csv, {
      clientId,
      uploadsDirectory: directories.uploads,
      mediaAssets,
      requireMediaExists: true,
    });
  }

  router.post('/bulk-import/preview', async (request, response) => {
    try {
      const body = request.body || {};
      const clientId = requestedOrAccessibleClientId(request, body.clientId, '');
      if (!clientId) return response.status(400).json({ error: '請先選擇品牌。', code: 'CLIENT_REQUIRED' });
      if (!canAccessClient(request, clientId)) return response.status(403).json({ error: '無法存取此品牌。', code: 'CLIENT_FORBIDDEN' });
      const clients = await listClients(repositories);
      if (!clients.some((client) => client.id === clientId)) return response.status(404).json({ error: '找不到品牌。', code: 'CLIENT_NOT_FOUND' });
      const result = await validateCsvForClient(body.csv || '', clientId);
      response.json({ clientId, ...result });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || 'CSV 預覽失敗。', code: error.code || 'BULK_IMPORT_PREVIEW_FAILED' });
    }
  });

  router.post('/bulk-import/commit', async (request, response) => {
    try {
      const body = request.body || {};
      const clientId = requestedOrAccessibleClientId(request, body.clientId, '');
      if (!clientId) return response.status(400).json({ error: '請先選擇品牌。', code: 'CLIENT_REQUIRED' });
      if (!canAccessClient(request, clientId)) return response.status(403).json({ error: '無法存取此品牌。', code: 'CLIENT_FORBIDDEN' });
      const clients = await listClients(repositories);
      if (!clients.some((client) => client.id === clientId)) return response.status(404).json({ error: '找不到品牌。', code: 'CLIENT_NOT_FOUND' });
      const preview = await validateCsvForClient(body.csv || '', clientId);
      if (!preview.valid) {
        return response.status(400).json({
          error: 'CSV 尚未通過逐列驗證，未建立任何貼文。',
          code: 'BULK_IMPORT_VALIDATION_FAILED',
          preview,
        });
      }
      const now = new Date();
      const drafts = preview.rows.map((row) => buildBulkDraft(row, { clientId, now }));
      await repositories.posts.mutate((records) => {
        assertCollectionCapacity('posts', records.length, drafts.length);
        records.push(...drafts);
      });
      await Promise.all(drafts.map((draft) => appendPostVersion({ post: draft, source: 'bulk_import' })));
      response.status(201).json({
        clientId,
        dryRun: false,
        createdCount: drafts.length,
        drafts,
        preview,
      });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || 'CSV 寫入失敗。', code: error.code || 'BULK_IMPORT_COMMIT_FAILED' });
    }
  });

  router.post('/bulk-import/schedule', async (request, response) => {
    try {
      const body = request.body || {};
      const clientId = requestedOrAccessibleClientId(request, body.clientId, '');
      if (!clientId) return response.status(400).json({ error: '請先選擇品牌。', code: 'CLIENT_REQUIRED' });
      if (!canAccessClient(request, clientId)) return response.status(403).json({ error: '無法存取此品牌。', code: 'CLIENT_FORBIDDEN' });
      const clients = await listClients(repositories);
      const client = clients.find((entry) => entry.id === clientId);
      if (!client) return response.status(404).json({ error: '找不到品牌。', code: 'CLIENT_NOT_FOUND' });

      const postIds = [...new Set((Array.isArray(body.postIds) ? body.postIds : [])
        .map((postId) => String(postId || '').trim())
        .filter(Boolean))];
      if (!postIds.length) return response.status(400).json({ error: '請提供要批次排程的草稿。', code: 'BULK_SCHEDULE_POSTS_REQUIRED' });
      if (postIds.length > 100) return response.status(400).json({ error: '單批最多只能套用 100 篇草稿。', code: 'BULK_SCHEDULE_ROW_LIMIT' });

      const now = new Date();
      const posts = await repositories.posts.list();
      const selectedPosts = postIds.map((postId) => posts.find((post) => post.id === postId));
      const missing = postIds.filter((postId, index) => !selectedPosts[index]);
      if (missing.length) {
        return response.status(404).json({
          error: '有草稿不存在，整批未套用排程。',
          code: 'BULK_SCHEDULE_POST_NOT_FOUND',
          postIds: missing,
        });
      }
      if (selectedPosts.some((post) => post.clientId !== clientId)) {
        return response.status(403).json({ error: '只能批次排程目前品牌的草稿。', code: 'BULK_SCHEDULE_CLIENT_MISMATCH' });
      }

      const plans = [];
      const issues = [];
      for (const post of selectedPosts) {
        const normalized = migrateLegacyPost(post, clientId);
        const importedSchedule = normalized.importedSchedule || {};
        const target = normalized.targets.find((entry) => entry.status === 'draft');
        const addIssue = (code, message) => issues.push({ postId: post.id, code, message });
        if (isPostIdea(normalized)) {
          addIssue('IDEA_NOT_READY', 'Idea 尚未轉成草稿，不能批次排程。');
          continue;
        }
        if (isPostArchived(normalized)) {
          addIssue('POST_ARCHIVED', '封存中的草稿不能批次排程。');
          continue;
        }
        if (!target || !importedSchedule.requestedAt) {
          addIssue('BULK_SCHEDULE_TIME_REQUIRED', '此草稿沒有可套用的匯入排程時間。');
          continue;
        }
        const scheduleTooSoon = rejectLocalScheduleTooSoon(importedSchedule.requestedAt, now);
        if (scheduleTooSoon) {
          addIssue('BULK_SCHEDULE_TIME_INVALID', scheduleTooSoon);
          continue;
        }
        const contentTypeError = rejectScheduleContentType(target.platformId, target.contentType);
        if (contentTypeError) {
          addIssue('BULK_SCHEDULE_CONTENT_TYPE_UNSUPPORTED', contentTypeError);
          continue;
        }
        const approval = approvalGate(normalized, client);
        if (!approval.allowed) {
          addIssue(approval.code || 'APPROVAL_REQUIRED', approval.message || '草稿尚未通過核准。');
          continue;
        }
        const validation = await validateTargetFormat({
          platformId: target.platformId,
          contentType: target.contentType,
          copy: resolveTargetCopy(normalized, target),
          mediaPaths: resolveTargetMedia(normalized, target),
          targetId: target.id,
          uploadsDirectory: directories.uploads,
        });
        if (!validation.valid) {
          addIssue('BULK_SCHEDULE_FORMAT_INVALID', validation.errors[0]?.message || '草稿格式驗證失敗。');
          continue;
        }
        plans.push({
          postId: post.id,
          baseVersion: Number(normalized.version || 1),
          targetId: target.id,
          scheduledAt: new Date(importedSchedule.requestedAt).toISOString(),
          timeZone: importedSchedule.timeZone || target.timeZone || null,
        });
      }
      if (issues.length) {
        return response.status(400).json({
          error: '批次排程驗證失敗，整批未套用任何排程。',
          code: 'BULK_SCHEDULE_VALIDATION_FAILED',
          issues,
        });
      }

      const scheduledAt = now.toISOString();
      const updated = await repositories.posts.mutate((storedPosts) => {
        const storedById = new Map(storedPosts.map((post) => [post.id, post]));
        const conflicts = plans.filter((plan) => Number(migrateLegacyPost(storedById.get(plan.postId), clientId).version || 1) !== plan.baseVersion);
        if (conflicts.length) {
          return {
            error: '批次排程期間有草稿被修改，整批未套用任何排程。',
            code: 'BULK_SCHEDULE_VERSION_CONFLICT',
            status: 409,
            issues: conflicts.map((plan) => ({ postId: plan.postId, code: 'POST_VERSION_CONFLICT', message: '草稿版本已變更，請重新整理後再試。' })),
          };
        }
        const results = [];
        for (const plan of plans) {
          const storedPost = storedById.get(plan.postId);
          const normalized = migrateLegacyPost(storedPost, clientId);
          const target = normalized.targets.find((entry) => entry.id === plan.targetId);
          if (!target) return {
            error: '批次排程目標已變更，整批未套用任何排程。',
            code: 'BULK_SCHEDULE_TARGET_CONFLICT',
            status: 409,
          };
          Object.assign(target, {
            scheduledAt: plan.scheduledAt,
            status: 'scheduled',
            scheduleMode: 'manual',
            scheduleSource: 'local',
            timeZone: plan.timeZone,
            externalId: null,
            lastError: null,
            nextAttemptAt: null,
          });
          normalized.importedSchedule = {
            ...(normalized.importedSchedule || {}),
            appliedAt: scheduledAt,
            appliedMode: 'local',
          };
          normalized.status = summarizePostStatus(normalized.targets);
          bumpPostVersion(normalized);
          addPostLifecycleEvent(normalized, 'bulk_scheduled', {
            targetId: target.id,
            scheduleSource: 'local',
          }, scheduledAt);
          Object.assign(storedPost, normalized);
          results.push({
            post: storedPost,
            item: {
              postId: storedPost.id,
              targetId: target.id,
              scheduledAt: target.scheduledAt,
              status: target.status,
              scheduleSource: target.scheduleSource,
              timeZone: target.timeZone,
            },
          });
        }
        return { results };
      });
      if (updated?.error) {
        return response.status(updated.status || 409).json({
          error: updated.error,
          code: updated.code || 'BULK_SCHEDULE_FAILED',
          issues: updated.issues || [],
        });
      }
      await Promise.all(updated.results.map(({ post }) => appendPostVersion({ post, source: 'bulk_schedule' })));
      response.status(201).json({
        clientId,
        scheduledCount: updated.results.length,
        scheduleMode: 'local',
        remoteScheduling: false,
        warning: '這次只套用本機排程；不會建立 Meta Planner 或其他平台的遠端排程。',
        items: updated.results.map(({ item }) => item),
        posts: updated.results.map(({ post }) => post),
      });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || '批次排程失敗。', code: error.code || 'BULK_SCHEDULE_FAILED' });
    }
  });

  return router;
}
