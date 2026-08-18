export function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function agendaItemsForView(items, { view, selectedDate, visibleDateKeys } = {}) {
  if (view === 'list') return items.slice();
  const keys = visibleDateKeys instanceof Set ? visibleDateKeys : new Set(visibleDateKeys || []);
  const inRange = items.filter((item) => keys.has(dateKey(new Date(item.scheduledAt))));
  if (selectedDate && (view === 'month' || view === 'week')) {
    return inRange.filter((item) => dateKey(new Date(item.scheduledAt)) === selectedDate);
  }
  return inRange;
}
