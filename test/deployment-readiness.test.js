import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProductionAuthEnabled, inspectDeploymentReadiness } from '../lib/deployment-readiness.js';

test('deployment readiness blocks missing secrets and flags non-HTTPS media', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: { NODE_ENV: 'production', PUBLIC_MEDIA_BASE_URL: 'http://media.example.test' },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [],
  });
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.checks.find((item) => item.id === 'master_key').status, 'fail');
  assert.equal(readiness.checks.find((item) => item.id === 'public_media_base_url').status, 'warn');
});

test('deployment readiness is ready when production prerequisites are present', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: {
      NODE_ENV: 'production',
      SHRINEFLOW_MASTER_KEY: 'a-secure-master-key',
      SHRINEFLOW_OPERATOR_PASSWORD: 'operator-password',
      SHRINEFLOW_SESSION_SECRET: 'session-secret',
      PUBLIC_MEDIA_BASE_URL: 'https://media.example.test',
      META_APP_SECRET: 'app-secret',
      META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [{ id: 'backup-1', createdAt: new Date().toISOString() }],
  });
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.mode, 'single_operator_json');
  assert.equal(readiness.checks.find((item) => item.id === 'meta_webhook').status, 'pass');
  assert.equal(readiness.checks.find((item) => item.id === 'backup_freshness').status, 'pass');
});
test('deployment readiness warns when the latest backup is stale', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: {
      NODE_ENV: 'production',
      SHRINEFLOW_MASTER_KEY: 'a-secure-master-key',
      SHRINEFLOW_OPERATOR_PASSWORD: 'operator-password',
      SHRINEFLOW_SESSION_SECRET: 'session-secret',
      PUBLIC_MEDIA_BASE_URL: 'https://media.example.test',
      META_APP_SECRET: 'app-secret',
      META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [{ id: 'backup-old', createdAt: '2020-01-01T00:00:00.000Z' }],
  });
  assert.equal(readiness.status, 'warning');
  assert.equal(readiness.checks.find((item) => item.id === 'backup_freshness').status, 'warn');
});

test('deployment readiness accepts Firebase production authentication', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: {
      NODE_ENV: 'production',
      SHRINEFLOW_AUTH_MODE: 'firebase',
      FIREBASE_API_KEY: 'web-api-key',
      FIREBASE_AUTH_DOMAIN: 'shrineflow.firebaseapp.com',
      FIREBASE_PROJECT_ID: 'shrineflow',
      FIREBASE_APP_ID: 'web-app-id',
      SHRINEFLOW_OWNER_EMAILS: 'owner@example.com',
      SHRINEFLOW_MASTER_KEY: 'a-secure-master-key',
      SHRINEFLOW_REAUTH_SECRET: 'reauth-secret',
      PUBLIC_MEDIA_BASE_URL: 'https://media.example.test',
      META_APP_SECRET: 'app-secret',
      META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [{ id: 'backup-1', createdAt: new Date().toISOString() }],
  });
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.checks.find((item) => item.id === 'operator_auth').status, 'pass');
  assert.equal(readiness.checks.find((item) => item.id === 'firebase_auth_config').status, 'pass');
  assert.equal(readiness.checks.find((item) => item.id === 'firebase_owner_bootstrap').status, 'pass');
  assert.equal(readiness.checks.find((item) => item.id === 'reauth_secret').status, 'pass');
});

test('deployment readiness blocks disabled production authentication', async () => {
  const readiness = await inspectDeploymentReadiness({
    env: {
      NODE_ENV: 'production',
      SHRINEFLOW_AUTH_MODE: 'disabled',
      SHRINEFLOW_MASTER_KEY: 'a-secure-master-key',
      PUBLIC_MEDIA_BASE_URL: 'https://media.example.test',
    },
    directoriesOverride: { data: 'data', uploads: 'uploads', backups: 'backups' },
    writableCheckImpl: async () => true,
    listBackupsImpl: async () => [{ id: 'backup-1', createdAt: new Date().toISOString() }],
  });
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.checks.find((item) => item.id === 'operator_auth').status, 'fail');
});

test('production boot refuses disabled authentication', () => {
  assert.throws(
    () => assertProductionAuthEnabled({ env: { NODE_ENV: 'production' }, authEnabled: false }),
    (error) => error.code === 'PRODUCTION_AUTH_REQUIRED',
  );
  assert.doesNotThrow(() => assertProductionAuthEnabled({
    env: { NODE_ENV: 'production' },
    authEnabled: true,
  }));
  assert.doesNotThrow(() => assertProductionAuthEnabled({
    env: { NODE_ENV: 'development' },
    authEnabled: false,
  }));
});
