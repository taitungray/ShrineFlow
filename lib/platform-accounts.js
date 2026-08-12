export function getPlatformAccounts({ facebookPageId = '', facebookConfigured = false } = {}) {
  return [
    {
      id: facebookPageId ? `facebook:${facebookPageId}` : 'facebook:default',
      platformId: 'facebook',
      name: facebookPageId ? `Facebook 粉專（${facebookPageId}）` : 'Facebook 粉專（預設帳號）',
      configured: facebookConfigured,
      enabled: true,
    },
    { id: 'instagram:default', platformId: 'instagram', name: 'Instagram（尚未連接帳號）', configured: false, enabled: false },
    { id: 'threads:default', platformId: 'threads', name: 'Threads（尚未連接帳號）', configured: false, enabled: false },
    { id: 'line:default', platformId: 'line', name: 'LINE VOOM（尚未連接帳號）', configured: false, enabled: false },
  ];
}

export function findPlatformAccount(accounts, accountId) {
  return accounts.find((account) => account.id === accountId) || null;
}
