function readErrorInfo(error) {
  const message = String(error?.message || error || '');
  let parsed = null;
  try {
    parsed = JSON.parse(message);
  } catch {
    // SDK errors often put the JSON payload inside a longer message.
    const start = message.indexOf('{');
    if (start >= 0) {
      try { parsed = JSON.parse(message.slice(start)); } catch { /* keep text fallback */ }
    }
  }
  const nested = parsed?.error || parsed || {};
  const status = Number(error?.status || error?.code || nested.code || 0);
  const statusText = String(error?.status || nested.status || '').toUpperCase();
  const transient = [408, 429, 500, 502, 503, 504].includes(status)
    || /UNAVAILABLE|RESOURCE_EXHAUSTED|HIGH DEMAND|TIMEOUT|OVERLOAD|TEMPORARILY/i.test(`${statusText} ${message}`);
  const modelSelection = status === 400 || status === 404
    ? /model|模型|not found|不存在/i.test(message)
    : false;
  return { message, status, transient, modelSelection };
}

export async function generateWithFallback({
  models,
  generate,
  maxAttempts = 3,
  baseDelayMs = 1_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const candidates = [...new Set(models.filter(Boolean))];
  let lastError;
  for (const model of candidates) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return { model, result: await generate(model) };
      } catch (error) {
        lastError = error;
        const info = readErrorInfo(error);
        const canTryAgain = info.transient || info.modelSelection;
        if (!canTryAgain || attempt === maxAttempts) break;
        await sleep(baseDelayMs * (2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

export function describeGeminiError(error, models = []) {
  const info = readErrorInfo(error);
  if (info.transient) {
    return `Gemini 目前忙碌或暫時無法服務，已自動重試 ${models.length ? models.join('、') : '目前模型'}。請稍後再試。`;
  }
  if (info.modelSelection) return 'Gemini 模型設定無法使用，請檢查 GEMINI_MODEL 或設定可用的 GEMINI_FALLBACK_MODELS。';
  if (info.status === 401 || info.status === 403) return 'Gemini API Key 無效或沒有權限，請重新確認 .env 設定。';
  return `Gemini 產文失敗：${info.message || '請稍後再試。'}`;
}
