import { getContentType, getPlatform } from './platforms.js';
import { validatePostFormat } from './content-validation.js';
import { rejectLocalScheduleTooSoon, rejectScheduleContentType, resolveScheduleTime } from './schedule-policy.js';
import { normalizeTarget } from './post-targets.js';

export const BULK_IMPORT_MAX_ROWS = 100;
export const BULK_IMPORT_HEADERS = Object.freeze([
  'contentTopic',
  'facebook',
  'platform',
  'contentType',
  'accountId',
  'mediaPaths',
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

function validPlatformContentType(platformId, contentType) {
  if (!SUPPORTED_PLATFORMS.has(platformId)) return false;
  const platform = getPlatform(platformId);
  return platform.contentTypes.some((item) => item.id === contentType);
}

export async function validateBulkCsv(input, {
  clientId = '',
  uploadsDirectory = null,
  probeMedia = null,
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
    const mediaPaths = mediaPathsFromCsv(values.mediaPaths);
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
        platformId,
        contentType,
        accountId: target.accountId,
        mediaPaths,
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
