const DATE_TIME_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;
const TIME_RE = /^(\d{2}):(\d{2})/;
const NATIVE_VALUE = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement?.prototype || {}, 'value');

export function pad2(value) {
  return String(Number(value) || 0).padStart(2, '0');
}

export function splitDateTimeLocal(value) {
  const match = String(value || '').match(DATE_TIME_LOCAL_RE);
  if (!match) return { date: '', hour: '', minute: '' };
  return { date: match[1], hour: match[2], minute: match[3] };
}

export function joinDateTimeLocal(date, hour, minute) {
  if (!date) return '';
  return date + 'T' + pad2(hour) + ':' + pad2(minute);
}

export function splitTimeValue(value) {
  const match = String(value || '').match(TIME_RE);
  if (!match) return { hour: '', minute: '' };
  return { hour: match[1], minute: match[2] };
}

export function joinTimeValue(hour, minute) {
  if (hour === '' && minute === '') return '';
  return pad2(hour) + ':' + pad2(minute);
}

function optionRange(endExclusive) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < endExclusive; index += 1) {
    const option = document.createElement('option');
    option.value = pad2(index);
    option.textContent = pad2(index);
    fragment.append(option);
  }
  return fragment;
}

function retargetLabel(input, dateInput) {
  if (!input.id) return;
  dateInput.id = input.id + '-date';
  document.querySelectorAll('label[for="' + CSS.escape(input.id) + '"]').forEach((label) => {
    label.setAttribute('for', dateInput.id);
  });
}

function isTimeOnly(input) {
  return input.type === 'time';
}

export function enhanceDateTimeInput(input) {
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.datetime24h === 'on') return;
  if (input.type !== 'datetime-local' && input.type !== 'time') return;

  input.dataset.datetime24h = 'on';
  const timeOnly = isTimeOnly(input);
  const wrap = document.createElement('div');
  wrap.className = timeOnly ? 'datetime-24h datetime-24h-time-only' : 'datetime-24h';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'datetime-24h-date';
  dateInput.autocomplete = 'off';

  const timeGroup = document.createElement('div');
  timeGroup.className = 'datetime-24h-time';
  timeGroup.setAttribute('role', 'group');
  timeGroup.setAttribute('aria-label', '時間（24 小時制）');

  const hourSelect = document.createElement('select');
  hourSelect.className = 'datetime-24h-hour';
  hourSelect.setAttribute('aria-label', '時');
  hourSelect.append(optionRange(24));

  const separator = document.createElement('span');
  separator.className = 'datetime-24h-sep';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = ':';

  const minuteSelect = document.createElement('select');
  minuteSelect.className = 'datetime-24h-minute';
  minuteSelect.setAttribute('aria-label', '分');
  minuteSelect.append(optionRange(60));

  timeGroup.append(hourSelect, separator, minuteSelect);

  input.classList.add('datetime-24h-native');
  input.setAttribute('tabindex', '-1');
  input.setAttribute('aria-hidden', 'true');

  const sourceAria = input.getAttribute('aria-label');
  if (timeOnly && sourceAria) timeGroup.setAttribute('aria-label', sourceAria + '（24 小時制）');

  input.parentNode?.insertBefore(wrap, input);
  if (timeOnly) wrap.append(timeGroup, input);
  else wrap.append(dateInput, timeGroup, input);
  if (!timeOnly) retargetLabel(input, dateInput);

  let syncing = false;

  function applyState() {
    const hidden = input.classList.contains('is-hidden') || input.hidden;
    wrap.classList.toggle('is-hidden', hidden);
    const disabled = input.disabled;
    dateInput.disabled = disabled;
    hourSelect.disabled = disabled;
    minuteSelect.disabled = disabled;
    dateInput.required = input.required;
  }

  function readNative() {
    if (timeOnly) {
      const parts = splitTimeValue(input.value);
      hourSelect.value = parts.hour || '00';
      minuteSelect.value = parts.minute || '00';
      return;
    }
    const parts = splitDateTimeLocal(input.value);
    dateInput.value = parts.date;
    hourSelect.value = parts.hour || '12';
    minuteSelect.value = parts.minute || '00';
  }

  function writeNative() {
    if (syncing) return;
    const next = timeOnly
      ? joinTimeValue(hourSelect.value, minuteSelect.value)
      : joinDateTimeLocal(dateInput.value, hourSelect.value, minuteSelect.value);
    if (input.value === next) return;
    syncing = true;
    try {
      if (NATIVE_VALUE?.set) NATIVE_VALUE.set.call(input, next);
      else input.setAttribute('value', next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      syncing = false;
    }
  }

  if (NATIVE_VALUE?.get && NATIVE_VALUE?.set) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: true,
      get() {
        return NATIVE_VALUE.get.call(this);
      },
      set(next) {
        NATIVE_VALUE.set.call(this, next);
        if (!syncing) readNative();
      },
    });
  }

  dateInput.addEventListener('input', writeNative);
  dateInput.addEventListener('change', writeNative);
  hourSelect.addEventListener('change', writeNative);
  minuteSelect.addEventListener('change', writeNative);
  input.addEventListener('invalid', (event) => {
    if (timeOnly) return;
    event.preventDefault();
    dateInput.setCustomValidity(input.validationMessage || '請選擇日期與時間');
    dateInput.reportValidity();
  });
  dateInput.addEventListener('input', () => dateInput.setCustomValidity(''));

  const observer = new MutationObserver(applyState);
  observer.observe(input, { attributes: true, attributeFilter: ['disabled', 'required', 'hidden', 'class'] });

  readNative();
  applyState();
}

export function enhanceDateTimeInputs(root = document) {
  root.querySelectorAll('input[type="datetime-local"], input[type="time"]').forEach(enhanceDateTimeInput);
}

export function initDateTime24h(root = document) {
  enhanceDateTimeInputs(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('input[type="datetime-local"], input[type="time"]')) enhanceDateTimeInput(node);
        node.querySelectorAll('input[type="datetime-local"], input[type="time"]').forEach(enhanceDateTimeInput);
      }
    }
  });
  observer.observe(root.documentElement || root, { childList: true, subtree: true });
}
