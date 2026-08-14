import 'dotenv/config';
import { createFirestoreRepositories, createLocalRepositories } from '../lib/repositories.js';

const source = createLocalRepositories();
const target = createFirestoreRepositories();
const collectionNames = [
  'gods',
  'posts',
  'schedule',
  'clients',
  'templates',
  'campaigns',
  'inboxMetadata',
  'notifications',
  'errorLog',
  'mediaAssets',
  'postVersions',
  'publishAttempts',
  'insightsSnapshots',
  'auditEvents',
];

for (const name of collectionNames) {
  const value = await source[name]?.list();
  if (value === undefined) continue;
  await target[name].replace(value);
  const count = Array.isArray(value) ? value.length : Object.keys(value || {}).length;
  console.log('Migrated ' + name + ': ' + count);
}

console.log('Migration completed for ' + target.firestore.projectId + '/' + target.firestore.databaseId + '.');
