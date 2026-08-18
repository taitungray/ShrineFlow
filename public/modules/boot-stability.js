export const SIGNED_IN_KEY = 'shrineflow.signedIn';
export const THEME_KEY = 'shrineflow.theme';
export const RESUME_QUIET_MS = 400;

export function rememberSignedIn(signedIn, storage = globalThis.localStorage) {
  try {
    if (signedIn) storage?.setItem?.(SIGNED_IN_KEY, '1');
    else storage?.removeItem?.(SIGNED_IN_KEY);
  } catch {
    // Privacy mode must not block auth.
  }
}

export function applyPinnedTheme({
  document: documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  storage = globalThis.localStorage,
} = {}) {
  const root = documentRef?.documentElement;
  if (!root) return 'light';
  let theme = null;
  try {
    theme = storage?.getItem?.(THEME_KEY);
  } catch {
    theme = null;
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  }
  root.dataset.theme = theme;
  try {
    storage?.setItem?.(THEME_KEY, theme);
  } catch {
    // Ignore quota and privacy-mode errors.
  }
  return theme;
}

export function endBooting({ document: documentRef = globalThis.document } = {}) {
  documentRef?.documentElement?.classList?.remove?.('is-booting');
}

export function initResumeStability({
  document: documentRef = globalThis.document,
  setTimeout: setTimeoutFn = globalThis.setTimeout,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
} = {}) {
  applyPinnedTheme({ document: documentRef, matchMedia });
  documentRef?.addEventListener?.('visibilitychange', () => {
    if ((documentRef.visibilityState || 'visible') !== 'visible') return;
    const root = documentRef.documentElement;
    root?.classList?.add?.('is-resuming');
    setTimeoutFn(() => {
      root?.classList?.remove?.('is-resuming');
    }, RESUME_QUIET_MS);
  });
  const media = matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', () => {
    setTimeoutFn(() => {
      const theme = media.matches ? 'dark' : 'light';
      if (documentRef.documentElement) documentRef.documentElement.dataset.theme = theme;
      try {
        globalThis.localStorage?.setItem?.(THEME_KEY, theme);
      } catch {
        // Ignore quota and privacy-mode errors.
      }
    }, RESUME_QUIET_MS);
  });
}
