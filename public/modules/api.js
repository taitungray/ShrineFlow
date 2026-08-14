export async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !String(path).includes('/api/auth/')) window.location.reload();
    const error = new Error(data.error || '請求失敗');
    error.status = response.status;
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return data;
}
