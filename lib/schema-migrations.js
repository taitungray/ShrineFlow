export const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_COLLECTIONS = [
  'clients',
  'posts',
  'schedule',
  'templates',
  'campaigns',
  'gods',
];

export async function runSchemaMigrations({
  repositories,
  migrations = [],
  currentVersion = CURRENT_SCHEMA_VERSION,
} = {}) {
  if (!repositories) throw new Error('Repositories are required to run schema migrations.');

  const results = [];
  for (const name of DEFAULT_COLLECTIONS) {
    const repository = repositories[name];
    if (!repository) continue;
    const fromVersion = Number(repository.schemaVersion || 1);
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw new Error(`Invalid schema version for repository ${name}.`);
    }
    if (fromVersion > currentVersion) {
      throw new Error(`Repository ${name} uses a newer schema version (${fromVersion}).`);
    }

    let version = fromVersion;
    for (const migration of migrations
      .filter((item) => item.collection === name)
      .sort((left, right) => Number(left.fromVersion) - Number(right.fromVersion))) {
      if (Number(migration.fromVersion) !== version) continue;
      if (typeof migration.up !== 'function') throw new Error(`Migration ${name} is missing an up function.`);
      await migration.up({ repository });
      version = Number(migration.toVersion);
    }

    results.push({ name, fromVersion, version, migrated: version !== fromVersion });
  }

  return {
    currentVersion,
    backend: repositories.backend || 'unknown',
    results,
  };
}
