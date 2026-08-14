import fs from 'node:fs/promises';
import path from 'node:path';

import { directories, makeId, mutateJson, readJson } from './store.js';
import {
  HISTORY_RETENTION_POLICIES,
  pruneHistoryArchives,
  trimHistoryRecords,
} from './history-retention.js';

export const POST_VERSION_POLICY = Object.freeze({
  maxActiveVersionsPerPost: 20,
  autosaveIntervalMs: 30_000,
});

const VERSION_FILE_PATTERN = /^\d{4}-\d{2}\.json$/;

function monthFile(createdAt) {
  return path.join(directories.postVersions, `${String(createdAt).slice(0, 7)}.json`);
}

function safeTarget(target = {}) {
  return {
    id: String(target.id || '').trim(),
    accountId: String(target.accountId || '').trim(),
    platformId: String(target.platformId || '').trim(),
    contentType: String(target.contentType || 'post').trim() || 'post',
    contentSettings: target.contentSettings && typeof target.contentSettings === 'object'
      ? { ...target.contentSettings }
      : {},
    timeZone: target.timeZone || null,
    copyOverride: target.copyOverride ?? null,
    mediaPaths: Array.isArray(target.mediaPaths) ? target.mediaPaths.slice(0, 20) : [],
  };
}

export function snapshotPostContent(post = {}) {
  return {
    clientId: post.clientId || '',
    contentTopic: post.contentTopic || post.godName || '',
    godName: post.godName || post.contentTopic || '',
    postType: post.postType || 'intro',
    extraNotes: post.extraNotes || '',
    channel: post.channel || '',
    accountId: post.accountId || '',
    contentType: post.contentType || 'post',
    contentSettings: post.contentSettings && typeof post.contentSettings === 'object'
      ? { ...post.contentSettings }
      : {},
    facebook: post.facebook || '',
    reel: post.reel || '',
    hashtags: Array.isArray(post.hashtags) ? post.hashtags.slice() : [],
    imagePath: post.imagePath || '',
    mediaPaths: Array.isArray(post.mediaPaths) ? post.mediaPaths.slice(0, 20) : [],
    targets: Array.isArray(post.targets) ? post.targets.map(safeTarget) : [],
  };
}

export function summarizePostVersion(post = {}) {
  const content = snapshotPostContent(post);
  const textLength = String(content.facebook || '').length + String(content.reel || '').length;
  return {
    contentTopic: content.contentTopic,
    platforms: [...new Set(content.targets.map((target) => target.platformId).filter(Boolean))],
    targetCount: content.targets.length,
    mediaCount: content.mediaPaths.length,
    textLength,
  };
}

function sameContent(left, right) {
  return JSON.stringify(snapshotPostContent(left)) === JSON.stringify(snapshotPostContent(right));
}

async function versionFiles() {
  const names = await fs.readdir(directories.postVersions).catch(() => []);
  return names.filter((name) => VERSION_FILE_PATTERN.test(name)).sort().reverse();
}

export async function listPostVersions(postId) {
  const records = [];
  for (const name of await versionFiles()) {
    const entries = await readJson(path.join(directories.postVersions, name), []);
    if (!Array.isArray(entries)) continue;
    records.push(...entries.filter((entry) => entry?.postId === postId));
  }
  return records.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

export async function getPostVersion(postId, versionId) {
  const versions = await listPostVersions(postId);
  return versions.find((version) => version.versionId === versionId) || null;
}

export async function appendPostVersion({
  post,
  source = 'manual',
  actor = 'operator',
  createdAt = new Date().toISOString(),
  force = false,
} = {}) {
  if (!post?.id) return { created: false, record: null };
  const existing = await listPostVersions(post.id);
  const latest = existing[0];
  const isSameAsLatest = latest && sameContent(latest.content, post);
  if (!force && isSameAsLatest) return { created: false, record: latest };
  if (source === 'autosave' && latest && Date.parse(createdAt) - Date.parse(latest.createdAt) < POST_VERSION_POLICY.autosaveIntervalMs) {
    return { created: false, record: latest };
  }

  const record = {
    versionId: makeId(),
    postId: post.id,
    version: Number(post.version || 1),
    createdAt,
    source,
    actor,
    content: snapshotPostContent(post),
    summary: summarizePostVersion(post),
  };
  const filePath = monthFile(createdAt);
  await mutateJson(filePath, (records) => {
    if (!Array.isArray(records)) records = [];
    records.push(record);
    trimHistoryRecords(records, HISTORY_RETENTION_POLICIES.postVersions.maxRecordsPerArchive);
  }, []);
  await pruneHistoryArchives(directories.postVersions, HISTORY_RETENTION_POLICIES.postVersions);
  return { created: true, record };
}

export function activePostVersions(versions = [], max = POST_VERSION_POLICY.maxActiveVersionsPerPost) {
  return versions.slice(0, max).map((version, index) => ({
    ...version,
    archived: index >= max,
    restorable: index < max,
  }));
}
