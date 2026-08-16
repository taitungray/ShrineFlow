import { $ } from './dom.js';
import { currentClient, state } from './state.js';
import { buildConnectionStatus } from './connection-status.js';

export { facebookStatusLabel } from './connection-status.js';

export function renderApiStatus() {
  const root = $('#apiStatus');
  if (!root) return;
  const view = buildConnectionStatus({
    client: currentClient(),
    config: state.config || {},
    facebookStatus: state.facebookStatus || {},
  });
  for (const item of [view.ai, view.fb]) {
    const el = root.querySelector(`[data-status="${item.key}"]`);
    if (!el) continue;
    el.dataset.ready = item.ready ? 'true' : 'false';
    el.title = item.text;
    el.textContent = item.label;
  }
  const summary = `${view.ai.text} · ${view.fb.text}`;
  root.title = summary;
  root.setAttribute('aria-label', summary);
}
