import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

import { directories } from '../lib/store.js';
import { createFirestoreRepositories } from '../lib/repositories.js';
import { createR2MediaStorage } from '../lib/r2-storage.js';
import { createPendingMediaAsset, finalizeMediaAsset } from '../lib/media-assets.js';
import {
  applyMediaMappingToRecords,
  applyMediaMigrationPlan,
  buildMediaMigrationPlan,
} from '../lib/media-migration.js';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    plan: !argv.includes('--apply'),
    apply: argv.includes('--apply'),
    dryRun: argv.includes('--dry-run'),
    planFile: '',
    out: path.join('data', 'backups', `media-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--plan-file') args.planFile = argv[++index] || '';
    if (token === '--out') args.out = argv[++index] || args.out;
  }
  if (args.dryRun) args.plan = true;
  return args;
}

function collectReferencedUploads(records = []) {
  const paths = new Set();
  const visit = (value) => {
    if (!value) return;
    if (typeof value === 'string' && value.startsWith('/uploads/')) paths.add(value);
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  records.forEach(visit);
  return [...paths];
}

async function main() {
  const args = parseArgs();
  const mediaStorage = createR2MediaStorage();

  if (args.apply) {
    const repositories = createFirestoreRepositories();
    if (!args.planFile) throw new Error('Apply requires --plan-file <path>.');
    const plan = JSON.parse(await fs.readFile(args.planFile, 'utf8'));
    if ((plan.conflicts || []).length) {
      throw new Error(`Media plan still has ${plan.conflicts.length} blocking conflict(s).`);
    }
    const result = await applyMediaMigrationPlan({
      plan,
      mediaStorage,
      upsertAsset: async (asset) => {
        await createPendingMediaAsset(asset, repositories);
        return finalizeMediaAsset(asset.id, { status: 'ready', checksumSha256: asset.checksumSha256 }, repositories);
      },
    });

    const posts = await repositories.posts.list();
    const schedule = await repositories.schedule.list();
    const postRewrite = applyMediaMappingToRecords(posts, result.mapping);
    const scheduleRewrite = applyMediaMappingToRecords(schedule, result.mapping);
    if (postRewrite.missing.length || scheduleRewrite.missing.length) {
      throw new Error('Missing media mapping for: ' + [...postRewrite.missing, ...scheduleRewrite.missing].join(', '));
    }
    if (postRewrite.changed) await repositories.posts.replace(postRewrite.records);
    if (scheduleRewrite.changed) await repositories.schedule.replace(scheduleRewrite.records);
    console.log(`Uploaded/reused ${result.uploaded.length} media objects.`);
    console.log(`Rewrote media references: posts=${postRewrite.changed}, schedule=${scheduleRewrite.changed}`);
    console.log('Media migration apply completed.');
    return;
  }

  const localPosts = await fs.readFile(path.join(directories.data, 'posts.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => []);
  const localSchedule = await fs.readFile(path.join(directories.data, 'schedule.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => []);
  const referencedPaths = collectReferencedUploads([
    ...(Array.isArray(localPosts) ? localPosts : []),
    ...(Array.isArray(localSchedule) ? localSchedule : []),
  ]);

  const plan = await buildMediaMigrationPlan({
    uploadsDirectory: directories.uploads,
    mediaStorage,
    referencedPaths,
  });

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(plan, null, 2), 'utf8');
  console.log(`Planned ${plan.files.length} upload files.`);
  console.log(`Conflicts: ${plan.conflicts.length}`);
  console.log(`Wrote media plan: ${args.out}`);
  if (args.dryRun || args.plan) {
    console.log('Dry run / plan only: no R2 objects or Firestore records were changed.');
  }
  if (plan.conflicts.length) {
    process.exitCode = 2;
    console.log('Resolve media conflicts before --apply.');
  } else {
    console.log('Plan is clean. Apply with: npm run migrate:media:r2 -- --apply --plan-file ' + args.out);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
