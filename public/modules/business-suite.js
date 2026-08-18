import { openBusinessSuiteUrl } from './business-suite-links.js';
import { currentClient, state } from './state.js';

export function currentFacebookPageId() {
  const client = currentClient();
  const facebook = (client?.accounts || []).find((account) => account.platformId === 'facebook' && account.configured)
    || (client?.accounts || []).find((account) => account.platformId === 'facebook');
  return String(
    facebook?.credentials?.pageId
    || state.facebookStatus?.page?.id
    || state.config?.facebookPage?.id
    || '',
  ).trim();
}

export function openBusinessSuite(options = {}, env = globalThis) {
  return openBusinessSuiteUrl({
    ...options,
    pageId: options.pageId || currentFacebookPageId(),
  }, env);
}

export function initBusinessSuiteButtons(root = document) {
  root.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-business-suite]');
    if (!trigger) return;
    event.preventDefault();
    openBusinessSuite({ dest: trigger.getAttribute('data-business-suite-dest') || 'home' });
  });
}
