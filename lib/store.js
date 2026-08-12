import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const directories = {
  data: path.join(rootDir, 'data'),
  uploads: path.join(rootDir, 'uploads'),
  prompts: path.join(rootDir, 'prompts'),
};

export const jsonFiles = {
  gods: path.join(directories.data, 'gods.json'),
  posts: path.join(directories.data, 'posts.json'),
  schedule: path.join(directories.data, 'schedule.json'),
};

export async function initStorage() {
  for (const directory of Object.values(directories)) {
    await fs.mkdir(directory, { recursive: true });
  }
  await ensureJsonFile(jsonFiles.gods, []);
  await ensureJsonFile(jsonFiles.posts, []);
  await ensureJsonFile(jsonFiles.schedule, []);
}

export async function ensureJsonFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

export async function readJson(filePath, fallback = []) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, value) {
  const temporaryPath = filePath + '.tmp';
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

const jsonMutationQueues = new Map();

export function mutateJson(filePath, mutator, fallback = []) {
  const previous = jsonMutationQueues.get(filePath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const value = await readJson(filePath, fallback);
    const result = await mutator(value);
    await writeJson(filePath, value);
    return result;
  });
  jsonMutationQueues.set(filePath, operation);
  return operation;
}

export function makeId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}
