export function createAiRateLimiter({
  maxRequests = 20,
  windowMs = 60_000,
  now = Date.now,
} = {}) {
  const hits = new Map();

  function assertAllowed(key) {
    const id = String(key || 'anonymous').slice(0, 120) || 'anonymous';
    const current = Number(now());
    const recent = (hits.get(id) || []).filter((timestamp) => current - timestamp < windowMs);
    if (recent.length >= maxRequests) {
      const error = new Error('AI 請求過於頻繁，請稍後再試。');
      error.status = 429;
      error.code = 'AI_RATE_LIMITED';
      throw error;
    }
    recent.push(current);
    hits.set(id, recent);
  }

  return { assertAllowed };
}
