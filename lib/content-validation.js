import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([
  '.avi', '.m4v', '.mov', '.mp4', '.mpeg', '.mpg', '.ogv', '.webm',
]);

const IMAGE_EXTENSIONS = new Set([
  '.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp',
]);

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

export const PLATFORM_FORMAT_POLICIES = Object.freeze({
  facebook: Object.freeze({
    textMax: 63206,
    contentTypes: Object.freeze({
      post: Object.freeze({ maxMedia: 10, mode: 'images-or-single-video' }),
      reel: Object.freeze({
        exactMedia: 1,
        mediaKind: 'video',
        video: Object.freeze({ minSeconds: 1, maxSeconds: 90, minAspectRatio: 0.01, maxAspectRatio: 10, recommendedAspectRatio: 9 / 16 }),
      }),
      story: Object.freeze({
        exactMedia: 1,
        video: Object.freeze({ minSeconds: 1, maxSeconds: 60 }),
      }),
    }),
  }),
  instagram: Object.freeze({
    textMax: 2200,
    contentTypes: Object.freeze({
      feed: Object.freeze({ maxMedia: 10, mode: 'images-or-single-video' }),
      reel: Object.freeze({
        exactMedia: 1,
        mediaKind: 'video',
        video: Object.freeze({ minSeconds: 3, maxSeconds: 900, minAspectRatio: 0.01, maxAspectRatio: 10, recommendedAspectRatio: 9 / 16 }),
      }),
      story: Object.freeze({
        exactMedia: 1,
        video: Object.freeze({ minSeconds: 1, maxSeconds: 60 }),
      }),
    }),
  }),
  threads: Object.freeze({
    textMax: 10000,
    textRecommendedMax: 500,
    contentTypes: Object.freeze({
      post: Object.freeze({ maxMedia: 1, video: Object.freeze({ minSeconds: 1, maxSeconds: 300 }) }),
    }),
  }),
});

function textLength(value) {
  return Array.from(String(value || '')).length;
}

function guessedMediaKind(mediaPath) {
  const extension = path.extname(String(mediaPath || '')).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return null;
}

function toContentType(platformId, contentType) {
  const normalizedPlatformId = String(platformId || '').trim();
  const normalizedContentType = String(contentType || '').trim() || 'post';
  if (normalizedPlatformId === 'instagram' && normalizedContentType === 'post') return 'feed';
  if (normalizedPlatformId === 'facebook' && normalizedContentType === 'feed') return 'post';
  return normalizedContentType;
}

function resolveUploadPath(mediaPath, uploadsDirectory) {
  if (!uploadsDirectory || !String(mediaPath || '').startsWith('/uploads/')) return null;
  return path.join(uploadsDirectory, path.basename(String(mediaPath)));
}

export async function probeMediaFile(filePath, {
  command = process.env.FFPROBE_PATH || 'ffprobe',
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  const { stdout } = await execFileAsync(command, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height,duration:format=duration',
    '-of', 'json',
    filePath,
  ], { timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 });
  const payload = JSON.parse(stdout || '{}');
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const image = streams.find((stream) => stream.codec_type === 'image');
  const stream = video || image || streams[0] || {};
  const duration = Number(video?.duration ?? payload.format?.duration);
  return {
    kind: video ? 'video' : (image ? 'image' : null),
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

async function inspectMedia(mediaPath, { uploadsDirectory, probeMedia }) {
  const kind = guessedMediaKind(mediaPath);
  const filePath = resolveUploadPath(mediaPath, uploadsDirectory);
  if (!filePath || typeof probeMedia !== 'function') {
    return { kind, verified: false, width: null, height: null, durationSeconds: null };
  }

  try {
    const metadata = await probeMedia(filePath);
    return {
      kind: metadata?.kind || kind,
      verified: true,
      width: Number(metadata?.width) || null,
      height: Number(metadata?.height) || null,
      durationSeconds: Number.isFinite(Number(metadata?.durationSeconds))
        ? Number(metadata.durationSeconds)
        : null,
    };
  } catch {
    return { kind, verified: false, width: null, height: null, durationSeconds: null };
  }
}

function addIssue(report, type, code, message) {
  report[type].push({ code, message });
}

function validateMediaKind(report, media, expectedKind, index) {
  if (!media.kind) {
    addIssue(report, 'warnings', 'media_kind_unverified', `第 ${index + 1} 個素材無法辨識類型，發布前仍需確認格式。`);
    return;
  }
  if (expectedKind && media.kind !== expectedKind) {
    addIssue(report, 'errors', 'media_kind_not_allowed', `第 ${index + 1} 個素材必須是${expectedKind === 'video' ? '影片' : '圖片'}。`);
  }
}

function validateMediaMode(report, mediaItems, mode) {
  if (mode !== 'images-or-single-video') return;
  const videos = mediaItems.filter((media) => media.kind === 'video').length;
  if (videos > 1 || (videos === 1 && mediaItems.length !== 1)) {
    addIssue(report, 'errors', 'media_mix_not_allowed', '影片不能和其他素材混合發布，且一次只能有一部影片。');
  }
}

function validateVideoMetadata(report, media, videoPolicy, index) {
  if (media.kind !== 'video' || !videoPolicy) return;
  if (!media.verified) {
    addIssue(report, 'warnings', 'video_metadata_unverified', `第 ${index + 1} 個影片無法讀取比例與長度，發布前會再次檢查。`);
    return;
  }

  if (media.durationSeconds == null) {
    addIssue(report, 'warnings', 'video_duration_unverified', `第 ${index + 1} 個影片缺少長度資訊，發布前會再次檢查。`);
  } else {
    if (videoPolicy.minSeconds != null && media.durationSeconds < videoPolicy.minSeconds) {
      addIssue(report, 'errors', 'video_too_short', `第 ${index + 1} 個影片至少需要 ${videoPolicy.minSeconds} 秒。`);
    }
    if (videoPolicy.maxSeconds != null && media.durationSeconds > videoPolicy.maxSeconds) {
      addIssue(report, 'errors', 'video_too_long', `第 ${index + 1} 個影片不可超過 ${videoPolicy.maxSeconds} 秒。`);
    }
  }

  if (media.width && media.height) {
    const ratio = media.width / media.height;
    if (videoPolicy.minAspectRatio != null && ratio < videoPolicy.minAspectRatio) {
      addIssue(report, 'errors', 'video_ratio_too_narrow', `第 ${index + 1} 個影片比例過窄，請調整為可發布比例。`);
    }
    if (videoPolicy.maxAspectRatio != null && ratio > videoPolicy.maxAspectRatio) {
      addIssue(report, 'errors', 'video_ratio_too_wide', `第 ${index + 1} 個影片比例過寬，請調整為可發布比例。`);
    }
    if (videoPolicy.recommendedAspectRatio && Math.abs(Math.log(ratio / videoPolicy.recommendedAspectRatio)) > 0.55) {
      addIssue(report, 'warnings', 'video_ratio_recommended', `第 ${index + 1} 個影片建議接近 9:16，避免平台裁切。`);
    }
  } else {
    addIssue(report, 'warnings', 'video_dimensions_unverified', `第 ${index + 1} 個影片缺少尺寸資訊，發布前會再次檢查比例。`);
  }
}

export async function validateTargetFormat({
  platformId,
  contentType = 'post',
  copy = '',
  mediaPaths = [],
  targetId = '',
  uploadsDirectory = null,
  probeMedia = null,
} = {}) {
  const normalizedPlatformId = String(platformId || '').trim();
  const normalizedContentType = toContentType(normalizedPlatformId, contentType);
  const platformPolicy = PLATFORM_FORMAT_POLICIES[normalizedPlatformId];
  const typePolicy = platformPolicy?.contentTypes?.[normalizedContentType];
  const report = {
    valid: true,
    platformId: normalizedPlatformId,
    contentType: normalizedContentType,
    targetId: String(targetId || ''),
    copyLength: textLength(copy),
    mediaCount: Array.isArray(mediaPaths) ? mediaPaths.length : 0,
    errors: [],
    warnings: [],
    media: [],
  };

  if (!platformPolicy) {
    addIssue(report, 'errors', 'platform_not_supported', '尚未支援此發布平台。');
  } else if (!typePolicy) {
    addIssue(report, 'errors', 'content_type_not_supported', `尚未支援 ${normalizedPlatformId} 的此內容格式。`);
  } else {
    if (report.copyLength > platformPolicy.textMax) {
      addIssue(report, 'errors', 'text_too_long', `文字長度 ${report.copyLength} 字，超過 ${platformPolicy.textMax} 字上限。`);
    }
    if (platformPolicy.textRecommendedMax && report.copyLength > platformPolicy.textRecommendedMax) {
      addIssue(report, 'warnings', 'text_over_recommended', `文字長度 ${report.copyLength} 字，超過建議的 ${platformPolicy.textRecommendedMax} 字；仍未超過平台硬上限。`);
    }

    const paths = Array.isArray(mediaPaths) ? mediaPaths : [];
    if (typePolicy.minMedia != null && paths.length < typePolicy.minMedia) {
      addIssue(report, 'errors', 'media_required', `此格式至少需要 ${typePolicy.minMedia} 個素材。`);
    }
    if (typePolicy.exactMedia != null && paths.length !== typePolicy.exactMedia) {
      addIssue(report, 'errors', 'media_count_invalid', `此格式必須剛好使用 ${typePolicy.exactMedia} 個素材。`);
    }
    if (typePolicy.maxMedia != null && paths.length > typePolicy.maxMedia) {
      addIssue(report, 'errors', 'media_count_exceeded', `此格式最多只能使用 ${typePolicy.maxMedia} 個素材。`);
    }

    const mediaItems = [];
    for (const [index, mediaPath] of paths.entries()) {
      const media = await inspectMedia(mediaPath, {
        uploadsDirectory,
        probeMedia: probeMedia || probeMediaFile,
      });
      mediaItems.push(media);
      report.media.push({
        index,
        kind: media.kind,
        verified: media.verified,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
      });
      validateMediaKind(report, media, typePolicy.mediaKind, index);
      validateVideoMetadata(report, media, typePolicy.video, index);
    }
    validateMediaMode(report, mediaItems, typePolicy.mode);
  }

  report.valid = report.errors.length === 0;
  return report;
}

export async function validatePostFormat(post = {}, {
  uploadsDirectory = null,
  probeMedia = null,
} = {}) {
  const targets = Array.isArray(post.targets) ? post.targets : [];
  const reports = [];
  for (const target of targets.slice(0, 20)) {
    const copy = target.copyOverride != null && String(target.copyOverride).trim() !== ''
      ? target.copyOverride
      : (target.contentType === 'reel' ? post.reel : post.facebook);
    const mediaPaths = Array.isArray(target.mediaPaths)
      ? target.mediaPaths
      : (Array.isArray(post.mediaPaths) ? post.mediaPaths : (post.imagePath ? [post.imagePath] : []));
    reports.push(await validateTargetFormat({
      platformId: target.platformId,
      contentType: target.contentType,
      copy,
      mediaPaths,
      targetId: target.id,
      uploadsDirectory,
      probeMedia,
    }));
  }
  const errors = reports.flatMap((report) => report.errors.map((issue) => ({
    ...issue,
    platformId: report.platformId,
    contentType: report.contentType,
    targetId: report.targetId,
  })));
  const warnings = reports.flatMap((report) => report.warnings.map((issue) => ({
    ...issue,
    platformId: report.platformId,
    contentType: report.contentType,
    targetId: report.targetId,
  })));
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    targets: reports,
  };
}

export function formatValidationError(report) {
  const error = new Error(report?.errors?.[0]?.message || '平台格式驗證未通過。');
  error.status = 400;
  error.validation = report;
  return error;
}
