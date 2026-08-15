import fs from 'node:fs/promises';
import path from 'node:path';

import { getContentType, getPlatform } from './platforms.js';
import { validatePostFormat } from './content-validation.js';
import { rejectLocalScheduleTooSoon, rejectScheduleContentType, resolveScheduleTime } from './schedule-policy.js';
import { normalizeTarget } from './post-targets.js';
import { addPostLifecycleEvent } from './post-lifecycle.js';
import { makeId } from './store.js';

export const BULK_IMPORT_MAX_ROWS = 100;
export const BULK_IMPORT_HEADERS = Object.freeze([
  'contentTopic',
  'facebook',
  'platform',
  'contentType',
  'accountId',
  'mediaPaths',
  'mediaIds',
  'scheduledLocal',
  'timeZone',
  'extraNotes',
]);

const HEADER_ALIASES = Object.freeze({
  topic: 'contentTopic',
  title: 'contentTopic',
  主題: 'contentTopic',
  文案: 'facebook',
  copy: 'facebook',
  platformId: 'platform',
  平台: 'platform',
  format: 'contentType',
  格式: 'contentType',
  media: 'mediaPaths',
  mediaPath: 'mediaPaths',
  素材: 'mediaPaths',
  mediaId: 'mediaIds',
  媒體ID: 'mediaIds',
  素材ID: 'mediaIds',
  schedule: 'scheduledLocal',
  排程時間: 'scheduledLocal',
  timezone: 'timeZone',
  時區: 'timeZone',
  備註: 'extraNotes',
});

const SUPPORTED_PLATFORMS = new Set(['facebook', 'instagram', 'threads']);

function normalizeHeader(value) {
  const header = String(value || '').trim();
  return HEADER_ALIASES[header] || header;
}

function issue(code, message, field = '') {
  return { code, message, ...(field ? { field } : {}) };
}

export function parseBulkCsv(input = '', { maxRows = BULK_IMPORT_MAX_ROWS } = {}) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const errors = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell === '') {
      quoted = true;
      closedQuote = false;
      continue;
    }
    if (closedQuote && character !== ',' && character !== '\n' && character !== '\r' && character !== ' ' && character !== '\t') {
      errors.push(issue('CSV_QUOTE_INVALID', '引號結束後只能接逗號或換行。'));
      closedQuote = false;
    }
    if (character === ',') {
      row.push(cell.trim());
      cell = '';
      closedQuote = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      closedQuote = false;
    } else {
      cell += character;
    }
  }
  if (quoted) errors.push(issue('CSV_QUOTE_UNCLOSED', 'CSV 有尚未關閉的引號。'));
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (!rows.length) return { headers: [], rows: [], errors: [issue('CSV_EMPTY', '請提供至少一列 CSV 標題與資料。')] };

  const headers = rows.shift().map(normalizeHeader);
  const headerSet = new Set();
  headers.forEach((header) => {
    if (!header) errors.push(issue('CSV_HEADER_EMPTY', 'CSV 標題不可為空。'));
    else if (headerSet.has(header)) errors.push(issue('CSV_HEADER_DUPLICATE', `CSV 標題重複：${header}。`, header));
    else if (!BULK_IMPORT_HEADERS.includes(header)) errors.push(issue('CSV_HEADER_UNSUPPORTED', `不支援的 CSV 欄位：${header}。`, header));
    headerSet.add(header);
  });
  if (!headerSet.has('contentTopic')) errors.push(issue('CSV_TOPIC_REQUIRED', 'CSV 必須包含 contentTopic 欄位。', 'contentTopic'));
  if (!headerSet.has('facebook')) errors.push(issue('CSV_COPY_REQUIRED', 'CSV 必須包含 facebook 欄位。', 'facebook'));
  if (rows.length > maxRows) errors.push(issue('CSV_ROW_LIMIT', `CSV 最多只能預覽 ${maxRows} 列。`));

  const mappedRows = rows.slice(0, maxRows).map((values, index) => {
    const record = {};
    headers.forEach((header, columnIndex) => {
      if (header && record[header] === undefined) record[header] = values[columnIndex] || '';
    });
    return { rowNumber: index + 2, values: record };
  });
  return { headers, rows: mappedRows, errors };
}

function mediaPathsFromCsv(value) {
  return String(value || '').split('|').map((item) => item.trim()).filter(Boolean);
}

function mediaIdsFromCsv(value) {
  return [...new Set(String(value || '').split('|').map((item) => item.trim()).filter(Boolean))];
}

async function localMediaPathExists(mediaPath, uploadsDirectory) {
  if (!String(mediaPath || '').startsWith('/uploads/')) return true;
  if (!uploadsDirectory) return false;
  const name = path.basename(String(mediaPath));
  if (!name || name === '.' || name === '..' || name !== String(mediaPath).slice('/uploads/'.length)) return false;
  try {
    return (await fs.stat(path.join(uploadsDirectory, name))).isFile();
  } catch {
    return false;
  }
}

async function resolveMediaReferences({
  mediaPaths,
  mediaIds,
  mediaAssets,
  clientId,
  uploadsDirectory,
  requireMediaExists,
} = {}) {
  const errors = [];
  const resolvedPaths = [...mediaPaths];
  const assetsById = new Map((Array.isArray(mediaAssets) ? mediaAssets : []).map((asset) => [String(asset.id || ''), asset]));
  for (const mediaId of mediaIds) {
    const asset = assetsById.get(mediaId);
    if (!asset || asset.clientId !== clientId || asset.status !== 'ready' || !asset.mediaPath) {
      errors.push(issue('MEDIA_ASSET_NOT_READY', `找不到可用的素材資產：${mediaId}。`, 'mediaIds'));
      continue;
    }
    resolvedPaths.push(asset.mediaPath);
  }
  const uniquePaths = [...new Set(resolvedPaths)];
  if (requireMediaExists) {
    for (const mediaPath of uniquePaths) {
      const isLocalPath = String(mediaPath).startsWith('/uploads/');
      const exists = isLocalPath
        ? await localMediaPathExists(mediaPath, uploadsDirectory)
        : assetsByIdHasPath(assetsById, mediaPath, clientId);
      if (!exists) errors.push(issue('MEDIA_REFERENCE_NOT_FOUND', `找不到可綁定的素材：${mediaPath}。`, 'mediaPaths'));
    }
  }
  return { mediaPaths: uniquePaths, errors };
}

function assetsByIdHasPath(assetsById, mediaPath, clientId) {
  return [...assetsById.values()].some((asset) => (
    asset.clientId === clientId && asset.status === 'ready' && asset.mediaPath === mediaPath
  ));
}

function validPlatformContentType(platformId, contentType) {
  if (!SUPPORTED_PLATFORMS.has(platformId)) return false;
  const platform = getPlatform(platformId);
  return platform.contentTypes.some((item) => item.id === contentType);
}

export async function validateBulkCsv(input, {
  clientId = '',
  uploadsDirectory = null,
  probeMedia = null,
  mediaAssets = [],
  requireMediaExists = false,
  now = new Date(),
  maxRows = BULK_IMPORT_MAX_ROWS,
} = {}) {
  const parsed = parseBulkCsv(input, { maxRows });
  const rows = [];
  for (const entry of parsed.rows) {
    const values = entry.values;
    const rowErrors = [];
    const platformId = String(values.platform || 'facebook').trim().toLowerCase();
    const contentType = String(values.contentType || getContentType(platformId, '').id || 'post').trim().toLowerCase();
    const contentTopic = String(values.contentTopic || '').trim();
    const facebook = String(values.facebook || '').trim();
    const reel = String(values.reel || facebook).trim();
    const mediaIds = mediaIdsFromCsv(values.mediaIds);
    const mediaReferenceResult = await resolveMediaReferences({
      mediaPaths: mediaPathsFromCsv(values.mediaPaths),
      mediaIds,
      mediaAssets,
      clientId,
      uploadsDirectory,
      requireMediaExists,
    });
    const mediaPaths = mediaReferenceResult.mediaPaths;
    rowErrors.push(...mediaReferenceResult.errors);
    const timeZone = String(values.timeZone || 'Asia/Taipei').trim() || 'Asia/Taipei';
    if (!contentTopic) rowErrors.push(issue('ROW_TOPIC_REQUIRED', '缺少內容主題。', 'contentTopic'));
    if (!facebook) rowErrors.push(issue('ROW_COPY_REQUIRED', '缺少 Facebook 文案。', 'facebook'));
    if (!SUPPORTED_PLATFORMS.has(platformId)) rowErrors.push(issue('ROW_PLATFORM_UNSUPPORTED', `不支援的平台：${platformId}。`, 'platform'));
    if (!validPlatformContentType(platformId, contentType)) rowErrors.push(issue('ROW_CONTENT_TYPE_UNSUPPORTED', `${platformId} 不支援格式 ${contentType}。`, 'contentType'));

    let scheduledAt = null;
    if (values.scheduledLocal) {
      const resolved = resolveScheduleTime({ scheduledLocal: values.scheduledLocal, timeZone });
      if (!resolved.ok) rowErrors.push(issue(resolved.code, resolved.message, 'scheduledLocal'));
      else {
        scheduledAt = resolved.scheduledAt;
        const tooSoon = rejectLocalScheduleTooSoon(scheduledAt, now);
        if (tooSoon) rowErrors.push(issue('SCHEDULE_TOO_SOON', tooSoon, 'scheduledLocal'));
      }
    }
    const scheduleTypeError = rejectScheduleContentType(platformId, contentType);
    if (scheduleTypeError && scheduledAt) rowErrors.push(issue('SCHEDULE_CONTENT_TYPE_UNSUPPORTED', scheduleTypeError, 'contentType'));

    const target = normalizeTarget({
      platformId,
      accountId: values.accountId || '',
      contentType,
      mediaPaths,
      scheduledAt,
      timeZone,
    });
    const validation = await validatePostFormat({
      clientId,
      contentTopic,
      facebook,
      reel,
      mediaPaths,
      targets: [target],
    }, { uploadsDirectory, probeMedia });
    rowErrors.push(...validation.errors);
    rows.push({
      rowNumber: entry.rowNumber,
      valid: rowErrors.length === 0,
      fields: {
        contentTopic,
        facebook,
        reel,
        extraNotes: String(values.extraNotes || '').trim(),
        platformId,
        contentType,
        accountId: target.accountId,
        mediaPaths,
        mediaIds,
        scheduledAt,
        timeZone,
      },
      errors: rowErrors,
      warnings: validation.warnings,
      validation,
    });
  }
  const validRowCount = rows.filter((row) => row.valid).length;
  return {
    valid: parsed.errors.length === 0 && rows.length > 0 && validRowCount === rows.length,
    headers: parsed.headers,
    parseErrors: parsed.errors,
    rows,
    rowCount: rows.length,
    validRowCount,
    invalidRowCount: rows.length - validRowCount,
    dryRun: true,
  };
}

export function buildBulkDraft(row, { clientId = '', now = new Date() } = {}) {
  const fields = row?.fields || {};
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const target = normalizeTarget({
    id: '',
    accountId: fields.accountId || '',
    platformId: fields.platformId || 'facebook',
    contentType: fields.contentType || 'post',
    mediaPaths: fields.mediaPaths || [],
    status: 'draft',
    scheduledAt: null,
    timeZone: fields.timeZone || null,
  });
  const draft = {
    id: makeId(),
    createdAt,
    updatedAt: createdAt,
    version: 1,
    clientId,
    createdBy: null,
    updatedBy: null,
    approvalState: 'draft',
    contentStage: 'draft',
    status: 'draft',
    contentTopic: fields.contentTopic || '',
    godName: fields.contentTopic || '',
    postType: 'intro',
    extraNotes: fields.extraNotes || '',
    channel: fields.platformId || 'facebook',
    accountId: fields.accountId || '',
    contentType: fields.contentType || 'post',
    contentSettings: {},
    imagePath: fields.mediaPaths?.[0] || '',
    mediaPaths: Array.isArray(fields.mediaPaths) ? fields.mediaPaths.slice() : [],
    mediaAssetIds: Array.isArray(fields.mediaIds) ? fields.mediaIds.slice() : [],
    facebook: fields.facebook || '',
    reel: fields.reel || fields.facebook || '',
    hashtags: [],
    targets: [target],
    importedSchedule: fields.scheduledAt
      ? { requestedAt: fields.scheduledAt, timeZone: fields.timeZone || 'Asia/Taipei' }
      : null,
  };
  addPostLifecycleEvent(draft, 'bulk_imported', { rowNumber: row?.rowNumber || null }, createdAt);
  return draft;
}
