import { getPlatformCapabilities } from './capabilities.js';

export function getPlatformAccounts({
  facebookPageId = '',
  facebookConfigured = false,
  instagramConfigured = false,
  threadsConfigured = false,
} = {}) {
  return [
    {
      id: facebookPageId ? `facebook:${facebookPageId}` : 'facebook:default',
      platformId: 'facebook',
      name: facebookPageId ? `Facebook 粉專（${facebookPageId}）` : 'Facebook 粉專（預設帳號）',
      configured: facebookConfigured,
      enabled: true,
      capabilities: getPlatformCapabilities({ platformId: 'facebook', configured: facebookConfigured }),
    },
    {
      id: 'instagram:default',
      platformId: 'instagram',
      name: instagramConfigured ? 'Instagram（預設帳號）' : 'Instagram（尚未連接帳號）',
      configured: instagramConfigured,
      enabled: instagramConfigured,
      capabilities: getPlatformCapabilities({ platformId: 'instagram', configured: instagramConfigured }),
    },
    {
      id: 'threads:default',
      platformId: 'threads',
      name: threadsConfigured ? 'Threads（預設帳號）' : 'Threads（尚未連接帳號）',
      configured: threadsConfigured,
      enabled: threadsConfigured,
      capabilities: getPlatformCapabilities({ platformId: 'threads', configured: threadsConfigured }),
    },
  ];
}

export function findPlatformAccount(accounts, accountId) {
  return accounts.find((account) => account.id === accountId) || null;
}
