import fs from 'node:fs/promises';

import {
  BACKUP_RETENTION_POLICY,
  getUploadQuotaStatus,
  listBackups,
} from './storage-management.js';
import { ERROR_LOG_RETENTION_POLICY, getErrorLogStats } from './error-log.js';
import { jsonFiles } from './store.js';
import {
  COLLECTION_STORAGE_POLICY,
  countStoredItems,
  getJsonStoragePolicy,
} from './storage-policy.js';

export const STORAGE_USAGE_WARNING_THRESHOLD = 0.8;

async function inspectJsonFile(filePath, collection) {
  const policy = getJsonStoragePolicy(filePath);
  try {
    const [raw, stats] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath),
    ]);
    const value = JSON.parse(raw);
    const itemCount = countStoredItems(collection, value);
    const maxItems = COLLECTION_STORAGE_POLICY[collection]?.maxItems || null;
    const maxBytes = policy.maxBytes;
    const itemUsageRatio = maxItems ? itemCount / maxItems : null;
    const byteUsageRatio = maxBytes ? stats.size / maxBytes : null;
    const warningReasons = [
      itemUsageRatio !== null && itemUsageRatio >= STORAGE_USAGE_WARNING_THRESHOLD ? 'items' : null,
      byteUsageRatio !== null && byteUsageRatio >= STORAGE_USAGE_WARNING_THRESHOLD ? 'bytes' : null,
    ].filter(Boolean);
    return {
      status: 'ok',
      bytes: stats.size,
      itemCount,
      maxItems,
      maxBytes,
      itemLimitReached: Boolean(maxItems && itemCount >= maxItems),
      byteLimitReached: stats.size >= maxBytes,
      usage: {
        itemRatio: itemUsageRatio,
        byteRatio: byteUsageRatio,
        status: warningReasons.length ? 'warning' : 'ok',
        warningReasons,
      },
    };
  } catch {
    try {
      JSON.parse(await fs.readFile(`${filePath}.bak`, 'utf8'));
      return {
        status: 'recovered',
        recoveryAvailable: true,
        maxItems: COLLECTION_STORAGE_POLICY[collection]?.maxItems || null,
        maxBytes: policy.maxBytes,
      };
    } catch {
      return {
        status: 'unavailable',
        recoveryAvailable: false,
        maxItems: COLLECTION_STORAGE_POLICY[collection]?.maxItems || null,
        maxBytes: policy.maxBytes,
      };
    }
  }
}

export async function inspectSystemHealth({
  schedulerIntervalMs = 0,
  schedulerRunning = false,
  listBackupsImpl = listBackups,
  uploadQuotaImpl = getUploadQuotaStatus,
  errorLogStatsImpl = getErrorLogStats,
} = {}) {
  const jsonEntries = await Promise.all(Object.entries(jsonFiles).map(async ([name, filePath]) => [
    name,
    await inspectJsonFile(filePath, name),
  ]));
  const jsonStatus = Object.fromEntries(jsonEntries);
  const jsonValues = Object.values(jsonStatus);
  const recovered = jsonValues.filter((item) => item.status === 'recovered').length;
  const unavailable = jsonValues.filter((item) => item.status === 'unavailable').length;
  const backups = await listBackupsImpl();
  const uploadQuota = await uploadQuotaImpl();
  const errorLogs = await errorLogStatsImpl();
  const uploadFileRatio = uploadQuota.policy.maxFileCount
    ? uploadQuota.fileCount / uploadQuota.policy.maxFileCount
    : null;
  const uploadByteRatio = uploadQuota.policy.maxTotalBytes
    ? uploadQuota.totalBytes / uploadQuota.policy.maxTotalBytes
    : null;
  const uploadWarningReasons = [
    uploadFileRatio !== null && uploadFileRatio >= STORAGE_USAGE_WARNING_THRESHOLD ? 'files' : null,
    uploadByteRatio !== null && uploadByteRatio >= STORAGE_USAGE_WARNING_THRESHOLD ? 'bytes' : null,
  ].filter(Boolean);

  return {
    status: unavailable || recovered ? 'degraded' : 'ok',
    generatedAt: new Date().toISOString(),
    scheduler: {
      running: Boolean(schedulerRunning),
      intervalSeconds: Number(schedulerIntervalMs) > 0 ? Number(schedulerIntervalMs) / 1000 : null,
    },
    storage: {
      jsonFiles: {
        total: jsonValues.length,
        healthy: jsonValues.filter((item) => item.status === 'ok').length,
        recovered,
        unavailable,
        policy: COLLECTION_STORAGE_POLICY,
        details: jsonStatus,
      },
      backups: {
        count: backups.length,
        latest: backups[0] ? {
          id: backups[0].id,
          createdAt: backups[0].createdAt,
          includesMedia: Boolean(backups[0].includesMedia),
        } : null,
        policy: BACKUP_RETENTION_POLICY,
      },
      uploads: {
        fileCount: uploadQuota.fileCount,
        totalBytes: uploadQuota.totalBytes,
        allowed: uploadQuota.allowed,
        policy: uploadQuota.policy,
        usage: {
          fileRatio: uploadFileRatio,
          byteRatio: uploadByteRatio,
          status: uploadWarningReasons.length ? 'warning' : 'ok',
          warningReasons: uploadWarningReasons,
        },
      },
      errorLogs: {
        count: errorLogs.count,
        policy: ERROR_LOG_RETENTION_POLICY,
      },
    },
  };
}
