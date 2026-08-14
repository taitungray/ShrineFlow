import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  appendScheduleFailureNotification,
  listNotifications,
  markNotificationRead,
  NOTIFICATION_RETENTION_POLICY,
} from '../lib/notifications.js';
import { jsonFiles, writeJson } from '../lib/store.js';

test('schedule failure notifications are bounded and can be acknowledged', async () => {
  const originalPath = jsonFiles.notifications;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-notifications-'));
  jsonFiles.notifications = path.join(temporaryDirectory, 'notifications.json');
  await writeJson(jsonFiles.notifications, { version: 1, items: [] });

  try {
    const notification = await appendScheduleFailureNotification({
      postId: 'post-1',
      targetId: 'target-1',
      platformId: 'instagram',
      attemptId: 'attempt-1',
      error: { message: 'provider failure', code: 'TEMPORARY', retriable: true },
    });
    assert.equal(notification.retriable, true);
    assert.equal(notification.message, 'provider failure');

    const unread = await listNotifications({ unreadOnly: true });
    assert.equal(unread.length, 1);
    assert.equal((await markNotificationRead(notification.id)).readAt != null, true);
    assert.equal((await listNotifications({ unreadOnly: true })).length, 0);

    for (let index = 0; index < NOTIFICATION_RETENTION_POLICY.maxItems + 5; index += 1) {
      await appendScheduleFailureNotification({
        postId: `post-${index}`,
        targetId: `target-${index}`,
        platformId: 'threads',
        error: { message: 'x'.repeat(1000) },
      });
    }
    const bounded = await listNotifications({ limit: 500 });
    assert.equal(bounded.length, NOTIFICATION_RETENTION_POLICY.maxItems);
    assert.ok(bounded.every((item) => item.message.length <= NOTIFICATION_RETENTION_POLICY.maxMessageLength));
  } finally {
    jsonFiles.notifications = originalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
