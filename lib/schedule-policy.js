export function rejectLocalScheduleTooSoon(scheduledAt, now = new Date()) {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return '排程時間格式不正確。';
  if (at.getTime() < now.getTime() + 60 * 1000) {
    return '排程時間須至少是 1 分鐘後。';
  }
  return null;
}

export function assertLocalScheduleWindow(scheduledAt, now = new Date()) {
  const error = rejectLocalScheduleTooSoon(scheduledAt, now);
  if (error) throw new Error(error);
  return new Date(scheduledAt);
}

export function rejectScheduleContentType(platformId, contentType) {
  if (platformId === 'facebook' && contentType === 'story') {
    return 'Facebook 限時動態不支援原生排程，請改用貼文或 Reel。';
  }
  return null;
}

function dateTimeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function localPartsToEpoch(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
  );
}

function sameDateTimeParts(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function parseLocalDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31
    || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  const calendarDate = new Date(localPartsToEpoch(parts));
  return sameDateTimeParts({ ...dateTimeParts(calendarDate, 'UTC') }, parts) ? parts : null;
}

export function resolveZonedDateTime(localDateTime, timeZone = 'Asia/Taipei') {
  const parts = parseLocalDateTime(localDateTime);
  if (!parts) {
    return { ok: false, code: 'SCHEDULE_LOCAL_INVALID', message: '排程本地時間格式無效。' };
  }

  try {
    const wallEpoch = localPartsToEpoch(parts);
    const sampleDates = [
      new Date(wallEpoch - 24 * 60 * 60 * 1000),
      new Date(wallEpoch),
      new Date(wallEpoch + 24 * 60 * 60 * 1000),
    ];
    const offsets = new Set(sampleDates.map((date) => localPartsToEpoch(dateTimeParts(date, timeZone)) - date.getTime()));
    const matches = [...offsets]
      .map((offset) => new Date(wallEpoch - offset))
      .filter((date) => sameDateTimeParts(dateTimeParts(date, timeZone), parts));

    if (matches.length === 0) {
      return { ok: false, code: 'SCHEDULE_DST_NONEXISTENT', message: '此時段在指定時區的夏令時間切換中不存在，請改選其他時間。' };
    }
    if (matches.length > 1) {
      return { ok: false, code: 'SCHEDULE_DST_AMBIGUOUS', message: '此時段在指定時區的夏令時間切換中重複，請改選其他時間。' };
    }
    return { ok: true, date: matches[0], timeZone, scheduledAt: matches[0].toISOString() };
  } catch {
    return { ok: false, code: 'SCHEDULE_TIMEZONE_INVALID', message: '排程時區無效，請使用 IANA 時區名稱。' };
  }
}

export function resolveScheduleTime({ scheduledAt, scheduledLocal, timeZone } = {}) {
  const normalizedTimeZone = String(timeZone || process.env.SHRINEFLOW_TIMEZONE || 'Asia/Taipei').trim();
  if (scheduledLocal) return resolveZonedDateTime(scheduledLocal, normalizedTimeZone);
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: '排程時間無效。' };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimeZone }).format(date);
  } catch {
    return { ok: false, code: 'SCHEDULE_TIMEZONE_INVALID', message: '排程時區無效，請使用 IANA 時區名稱。' };
  }
  return { ok: true, date, timeZone: normalizedTimeZone, scheduledAt: date.toISOString() };
}
