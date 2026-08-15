import fs from 'node:fs/promises';
import path from 'node:path';

import { directories } from './store.js';
import { listBackups } from './storage-management.js';

export const BACKUP_READINESS_MAX_AGE_DAYS = 7;

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

function configuredAuthMode(env) {
  const requestedMode = String(env.SHRINEFLOW_AUTH_MODE || '').trim().toLowerCase();
  if (requestedMode) return requestedMode;
  return String(env.SHRINEFLOW_OPERATOR_PASSWORD || '').trim()
    && String(env.SHRINEFLOW_SESSION_SECRET || '').trim()
    ? 'legacy'
    : 'disabled';
}

function addAuthenticationChecks(checks, env) {
  const mode = configuredAuthMode(env);
  if (!['legacy', 'firebase', 'disabled'].includes(mode)) {
    checks.push(check('operator_auth', 'fail', `不支援的 SHRINEFLOW_AUTH_MODE「${mode}」。`));
    return;
  }

  if (mode === 'legacy') {
    const configured = Boolean(String(env.SHRINEFLOW_OPERATOR_PASSWORD || '').trim()
      && String(env.SHRINEFLOW_SESSION_SECRET || '').trim());
    checks.push(configured
      ? check('operator_auth', 'pass', '單一操作員登入已啟用。')
      : check('operator_auth', 'fail', '正式部署前必須設定單一操作員密碼與 session secret。'));
    return;
  }

  if (mode === 'firebase') {
    const firebaseConfig = [
      ['FIREBASE_API_KEY', env.FIREBASE_API_KEY],
      ['FIREBASE_AUTH_DOMAIN', env.FIREBASE_AUTH_DOMAIN],
      ['FIREBASE_PROJECT_ID 或 GOOGLE_CLOUD_PROJECT', env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT],
      ['FIREBASE_APP_ID', env.FIREBASE_APP_ID],
    ];
    const missing = firebaseConfig.filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
    checks.push(missing.length
      ? check('firebase_auth_config', 'fail', `Firebase 登入設定缺少：${missing.join('、')}。`)
      : check('firebase_auth_config', 'pass', 'Firebase Web 登入設定完整。'));
    const ownerBootstrapConfigured = Boolean(
      String(env.SHRINEFLOW_OWNER_EMAILS || '').trim()
      || String(env.SHRINEFLOW_OWNER_UIDS || '').trim(),
    );
    checks.push(ownerBootstrapConfigured
      ? check('firebase_owner_bootstrap', 'pass', 'Firebase 首位 Owner 白名單已設定。')
      : check('firebase_owner_bootstrap', 'warn', '尚未設定首位 Owner 白名單；新環境第一次登入將無法自動建立 Owner。'));
    checks.push(check('operator_auth', 'pass', 'Firebase 多人登入已啟用。'));
    const reauthSecret = String(env.SHRINEFLOW_REAUTH_SECRET || env.SHRINEFLOW_SESSION_SECRET || '').trim();
    checks.push(reauthSecret
      ? check('reauth_secret', 'pass', '敏感操作二次驗證密鑰已設定。')
      : check('reauth_secret', 'warn', '尚未設定 SHRINEFLOW_REAUTH_SECRET；成員／憑證／系統設定的二次驗證無法啟用。'));
    return;
  }

  checks.push(check('operator_auth', 'fail', '正式部署不可使用 disabled 登入模式。'));
}

export function assertProductionAuthEnabled({ env = process.env, authEnabled } = {}) {
  if (String(env.NODE_ENV || '').toLowerCase() !== 'production') return { ok: true };
  if (authEnabled) return { ok: true };
  const error = new Error('正式環境拒絕在未啟用登入的狀態下啟動。請設定 Firebase 或操作員密碼。');
  error.code = 'PRODUCTION_AUTH_REQUIRED';
  error.status = 503;
  throw error;
}

export async function inspectDeploymentReadiness({
  env = process.env,
  directoriesOverride = directories,
  listBackupsImpl = listBackups,
  writableCheckImpl = probeWritable,
} = {}) {
  const checks = [];
  const cloudRuntime = String(env.SHRINEFLOW_STORAGE_BACKEND || '').toLowerCase() === 'firestore'
    && ['r2', 'cloudflare-r2'].includes(String(env.SHRINEFLOW_MEDIA_BACKEND || '').toLowerCase());
  if (cloudRuntime) {
    checks.push(String(env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '').trim()
      ? check('firestore_config', 'pass', 'Firestore project is configured.')
      : check('firestore_config', 'fail', 'FIRESTORE_PROJECT_ID is required for cloud storage.'));
    const r2Configured = Boolean(
      String(env.R2_BUCKET || '').trim()
      && String(env.R2_ACCESS_KEY_ID || '').trim()
      && String(env.R2_SECRET_ACCESS_KEY || '').trim()
      && String(env.R2_ENDPOINT || env.R2_ACCOUNT_ID || '').trim(),
    );
    checks.push(r2Configured
      ? check('r2_config', 'pass', 'R2 bucket and credentials are configured.')
      : check('r2_config', 'fail', 'R2 bucket, endpoint and credentials are required for cloud media.'));
    checks.push(String(env.SHRINEFLOW_SCHEDULER_MODE || '').toLowerCase() === 'cloud'
      ? check('cloud_scheduler', 'pass', 'Cloud Scheduler mode is enabled.')
      : check('cloud_scheduler', 'fail', 'SHRINEFLOW_SCHEDULER_MODE must be cloud in production.'));
  }
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

  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    addAuthenticationChecks(checks, env);
  } else {
    const mode = configuredAuthMode(env);
    checks.push(mode === 'disabled'
      ? check('operator_auth', 'warn', '目前未啟用登入；本機模式可接受，公網部署不可接受。')
      : check('operator_auth', 'pass', `${mode === 'firebase' ? 'Firebase 多人' : '單一操作員'}登入已啟用。`));
  }

  const webhookAppSecret = String(env.META_APP_SECRET || '').trim();
  const webhookVerifyToken = String(env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
  checks.push(webhookAppSecret && webhookVerifyToken
    ? check('meta_webhook', 'pass', 'Meta webhook 驗證設定完整。')
    : check('meta_webhook', 'warn', webhookAppSecret || webhookVerifyToken
      ? 'Meta webhook 設定不完整；請同時設定 app secret 與 verify token。'
      : '尚未設定 Meta webhook；Inbox webhook 同步在正式部署時將不可用。'));

  if (!cloudRuntime) for (const [id, directory] of [
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

  const latestBackup = backups[0];
  const latestBackupAt = Date.parse(latestBackup?.createdAt || '');
  const backupAgeMs = BACKUP_READINESS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  checks.push(!latestBackup
    ? check('backup_freshness', 'warn', '沒有可檢查的新備份。')
    : !Number.isFinite(latestBackupAt)
      ? check('backup_freshness', 'warn', '最新備份缺少有效建立時間，請重新建立備份。')
      : Date.now() - latestBackupAt > backupAgeMs
        ? check('backup_freshness', 'warn', `最新備份已超過 ${BACKUP_READINESS_MAX_AGE_DAYS} 天，請先建立新備份並演練還原。`)
        : check('backup_freshness', 'pass', `最新備份在 ${BACKUP_READINESS_MAX_AGE_DAYS} 天內。`));
  const hasFailure = checks.some((item) => item.status === 'fail');
  const hasWarning = checks.some((item) => item.status === 'warn');
  return {
    status: hasFailure ? 'blocked' : (hasWarning ? 'warning' : 'ready'),
    mode: cloudRuntime ? 'cloud_firestore_r2' : 'single_operator_json',
    generatedAt: new Date().toISOString(),
    checks,
  };
}
