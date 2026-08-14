import { makeId } from './store.js';
import { resolveZonedDateTime } from './schedule-policy.js';

export const QUEUE_MAX_SLOTS = 32;
export const QUEUE_HORIZON_DAYS = 180;
export const QUEUE_ACTIVE_STATUSES = Object.freeze([
  'scheduled',
  'pending',
  'retrying',
  'publishing',
]);

function validTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeSlotId(value, weekday, localTime) {
  const id = String(value || '').trim();
  return id || `slot-${weekday}-${localTime.replace(':', '')}`;
}

function normalizeSlot(slot = {}) {
  const weekday = Number(slot.weekday);
  const localTime = String(slot.localTime || slot.time || '').trim();
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error('佇列時段的星期必須介於 1 到 7。');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    throw new Error('佇列時段必須使用 HH:mm 格式。');
  }
  return {
    id: normalizeSlotId(slot.id, weekday, localTime),
    weekday,
    localTime,
    enabled: slot.enabled !== false,
  };
}

export function normalizeQueue(input = {}, { accountId = '', platformId = '' } = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const timeZone = String(raw.timeZone || process.env.SHRINEFLOW_TIMEZONE || 'Asia/Taipei').trim();
  if (!validTimeZone(timeZone)) throw new Error('佇列時區無效，請使用 IANA 時區名稱。');

  const rawSlots = Array.isArray(raw.slots) ? raw.slots : [];
  if (rawSlots.length > QUEUE_MAX_SLOTS) {
    throw new Error(`佇列最多只能設定 ${QUEUE_MAX_SLOTS} 個時段。`);
  }
  const slots = rawSlots.map(normalizeSlot);
  const unique = new Set(slots.map((slot) => `${slot.weekday}:${slot.localTime}`));
  if (unique.size !== slots.length) throw new Error('佇列不能有重複的星期與時間。');
  if (raw.enabled && !slots.some((slot) => slot.enabled)) {
    throw new Error('啟用佇列前至少需要一個有效時段。');
  }

  return {
    id: String(raw.id || '').trim() || `queue-${accountId || platformId || makeId()}`,
    enabled: Boolean(raw.enabled),
    paused: Boolean(raw.paused),
    timeZone,
    slots,
    updatedAt: String(raw.updatedAt || '').trim() || null,
  };
}

function dateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

function utcDateParts(date) {
  return dateParts(date, 'UTC');
}

function localDateTime(year, month, day, localTime) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${localTime}`;
}

function activeSlots(queue) {
  return queue.slots
    .filter((slot) => slot.enabled)
    .slice()
    .sort((left, right) => left.weekday - right.weekday || left.localTime.localeCompare(right.localTime));
}

export function nextQueueSequence(existingSchedules = []) {
  return existingSchedules.reduce((highest, item) => Math.max(highest, Number(item.queueSequence) || 0), 0) + 1;
}

export function nextQueueSlot({
  queue: inputQueue,
  fromDate = new Date(),
  existingSchedules = [],
  minimumLeadMs = 60 * 1000,
  maxDays = QUEUE_HORIZON_DAYS,
} = {}) {
  const queue = normalizeQueue(inputQueue);
  if (!queue.enabled || queue.paused) return null;
  const slots = activeSlots(queue);
  if (!slots.length) return null;

  const now = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(now.getTime())) return null;
  const minimum = now.getTime() + minimumLeadMs;
  const base = dateParts(now, queue.timeZone);
  const occupied = new Set(existingSchedules
    .filter((item) => QUEUE_ACTIVE_STATUSES.includes(item.status) && item.scheduledAt)
    .map((item) => new Date(item.scheduledAt).getTime())
    .filter((timestamp) => Number.isFinite(timestamp)));

  for (let offset = 0; offset <= maxDays; offset += 1) {
    const calendarDate = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const calendar = utcDateParts(calendarDate);
    const weekday = calendarDate.getUTCDay() || 7;
    for (const slot of slots) {
      if (slot.weekday !== weekday) continue;
      const scheduledLocal = localDateTime(calendar.year, calendar.month, calendar.day, slot.localTime);
      const resolution = resolveZonedDateTime(scheduledLocal, queue.timeZone);
      if (!resolution.ok) continue;
      const timestamp = resolution.date.getTime();
      if (timestamp <= minimum || occupied.has(timestamp)) continue;
      return {
        scheduledAt: resolution.date.toISOString(),
        scheduledLocal,
        timeZone: queue.timeZone,
        queueId: queue.id,
        queueSlotId: slot.id,
      };
    }
  }
  return null;
}
