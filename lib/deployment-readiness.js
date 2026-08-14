import fs from 'node:fs/promises';
import path from 'node:path';

import { directories } from './store.js';
import { listBackups } from './storage-management.js';

async function probeWritable(directory) {
  const probePath = path.join(directory, `.shrineflow-readiness-${process.pid}`);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(probePath, 'ok', 'utf8');
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(probePath, { force: true }).catch(() => {});
  }
}

function check(id, status, message) {
  return { id, status, message };
}

export async function inspectDeploymentReadiness({
  env = process.env,
  directoriesOverride = directories,
  listBackupsImpl = listBackups,
  writableCheckImpl = probeWritable,
} = {}) {
  const checks = [];
  const masterKey = String(env.SHRINEFLOW_MASTER_KEY || '').trim();
  checks.push(masterKey
    ? check('master_key', 'pass', '主密鑰已設定。')
    : check('master_key', 'fail', '正式部署前必須設定 SHRINEFLOW_MASTER_KEY。'));

  const mediaBaseUrl = String(env.PUBLIC_MEDIA_BASE_URL || '').trim();
  if (!mediaBaseUrl) {
    checks.push(check('public_media_base_url', 'warn', '尚未設定 PUBLIC_MEDIA_BASE_URL；Instagram／Threads 媒體發布將不可用。'));
  } else {
    try {
      const parsed = new URL(mediaBaseUrl);
      checks.push(parsed.protocol === 'https:'
        ? check('public_media_base_url', 'pass', '公開媒體網址使用 HTTPS。')
        : check('public_media_base_url', 'warn', '公開媒體網址不是 HTTPS，正式部署不建議使用。'));
    } catch {
      checks.push(check('public_media_base_url', 'fail', 'PUBLIC_MEDIA_BASE_URL 必須是完整網址。'));
    }
  }

  checks.push(String(env.NODE_ENV || '').toLowerCase() === 'production'
    ? check('node_environment', 'pass', 'NODE_ENV 已設定為 production。')
    : check('node_environment', 'warn', 'NODE_ENV 不是 production；目前仍以開發模式啟動。'));

  for (const [id, directory] of [
    ['data_writable', directoriesOverride.data],
    ['uploads_writable', directoriesOverride.uploads],
    ['backups_writable', directoriesOverride.backups],
  ]) {
    checks.push(await writableCheckImpl(directory)
      ? check(id, 'pass', '儲存目錄可寫入。')
      : check(id, 'fail', '儲存目錄不可寫入。'));
  }

  const backups = await listBackupsImpl();
  checks.push(backups.length
    ? check('backup_available', 'pass', `已有 ${backups.length} 份可用備份。`)
    : check('backup_available', 'warn', '尚未建立備份；正式部署前應先建立並演練還原。'));

  const hasFailure = checks.some((item) => item.status === 'fail');
  const hasWarning = checks.some((item) => item.status === 'warn');
  return {
    status: hasFailure ? 'blocked' : (hasWarning ? 'warning' : 'ready'),
    mode: 'single_operator_json',
    generatedAt: new Date().toISOString(),
    checks,
  };
}
