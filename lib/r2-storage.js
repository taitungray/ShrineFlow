import crypto from 'node:crypto';

const DEFAULT_REGION = 'auto';
const DEFAULT_UPLOAD_TTL_SECONDS = 900;
const MAX_UPLOAD_TTL_SECONDS = 3600;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding = undefined) {
  const result = crypto.createHmac('sha256', key).update(value).digest();
  return encoding ? result.toString(encoding) : result;
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => (
    '%' + character.charCodeAt(0).toString(16).toUpperCase()
  ));
}

function encodeKey(key) {
  return String(key || '').split('/').map(encodeRfc3986).join('/');
}

function safeFilename(value) {
  const raw = String(value || '').trim();
  const name = raw.split(/[\\/]/).pop() || 'upload';
  return name.replace(/[^\w.\-\u00C0-\uFFFF]+/g, '_').slice(0, 180) || 'upload';
}

function safePathKey(value) {
  const raw = String(value || '').trim().replace(/^\/+/, '');
  if (!raw || raw.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return raw;
}

function mediaKeyFromPath(mediaPath) {
  const raw = String(mediaPath || '').trim();
  if (raw.startsWith('/media/')) return safePathKey(decodeURIComponent(raw.slice('/media/'.length)));
  if (raw.startsWith('/uploads/')) {
    const filename = safeFilename(raw.slice('/uploads/'.length));
    return filename ? 'legacy/' + filename : null;
  }
  return null;
}

function mediaPathFromKey(key) {
  return '/media/' + encodeKey(key);
}

function createMediaId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex');
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export class R2ConfigurationError extends Error {
  constructor(message, code = 'R2_CONFIGURATION_ERROR') {
    super(message);
    this.name = 'R2ConfigurationError';
    this.code = code;
    this.status = 503;
  }
}

function canonicalQuery(parameters) {
  return Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => encodeRfc3986(key) + '=' + encodeRfc3986(value))
    .join('&');
}

function signingKey(secretAccessKey, shortDate, region, service) {
  const dateKey = hmac('AWS4' + secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

export function createR2MediaStorage({
  accountId = process.env.R2_ACCOUNT_ID,
  bucket = process.env.R2_BUCKET,
  accessKeyId = process.env.R2_ACCESS_KEY_ID,
  secretAccessKey = process.env.R2_SECRET_ACCESS_KEY,
  endpoint = process.env.R2_ENDPOINT,
  publicBaseUrl = process.env.R2_PUBLIC_BASE_URL || process.env.PUBLIC_MEDIA_BASE_URL,
  region = process.env.R2_REGION || DEFAULT_REGION,
  uploadTtlSeconds = process.env.R2_UPLOAD_TTL_SECONDS,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedAccountId = String(accountId || '').trim();
  const normalizedBucket = String(bucket || '').trim();
  const normalizedAccessKeyId = String(accessKeyId || '').trim();
  const normalizedSecret = String(secretAccessKey || '').trim();
  const normalizedEndpoint = String(endpoint || (
    normalizedAccountId ? 'https://' + normalizedAccountId + '.r2.cloudflarestorage.com' : ''
  )).replace(/\/$/, '');
  const normalizedPublicBaseUrl = String(publicBaseUrl || '').trim().replace(/\/$/, '');
  const ttl = Math.min(
    MAX_UPLOAD_TTL_SECONDS,
    Math.max(60, Number(uploadTtlSeconds) || DEFAULT_UPLOAD_TTL_SECONDS),
  );
  const configured = Boolean(normalizedBucket && normalizedAccessKeyId && normalizedSecret && normalizedEndpoint);

  function assertConfigured() {
    if (!configured) {
      throw new R2ConfigurationError(
        'R2 requires R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ENDPOINT or R2_ACCOUNT_ID.',
        'R2_CREDENTIALS_REQUIRED',
      );
    }
    if (typeof fetchImpl !== 'function') throw new R2ConfigurationError('R2 requires a fetch implementation.', 'R2_FETCH_REQUIRED');
  }

  function objectUrl(key) {
    return normalizedEndpoint + '/' + encodeRfc3986(normalizedBucket) + '/' + encodeKey(key);
  }

  function signedUrl(method, key, { expiresIn = ttl } = {}) {
    assertConfigured();
    const objectKey = safePathKey(key);
    if (!objectKey) throw new Error('R2 object key is invalid.');
    const url = new URL(objectUrl(objectKey));
    const host = url.host;
    const amzDate = isoDate(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const shortDate = amzDate.slice(0, 8);
    const credential = normalizedAccessKeyId + '/' + shortDate + '/' + region + '/s3/aws4_request';
    const query = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(Math.min(MAX_UPLOAD_TTL_SECONDS, Math.max(1, Number(expiresIn) || ttl))),
      'X-Amz-SignedHeaders': 'host',
    };
    const queryString = canonicalQuery(query);
    const canonicalHeaders = 'host:' + host + '\n';
    const canonicalRequest = [
      method.toUpperCase(),
      url.pathname,
      queryString,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const scope = shortDate + '/' + region + '/s3/aws4_request';
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join('\n');
    const signature = hmac(signingKey(normalizedSecret, shortDate, region, 's3'), stringToSign, 'hex');
    Object.entries({ ...query, 'X-Amz-Signature': signature }).forEach(([name, value]) => url.searchParams.set(name, value));
    return url.toString();
  }

  async function requestObject(method, key, options = {}) {
    const response = await fetchImpl(signedUrl(method, key, options), {
      method,
      headers: options.headers || {},
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    if (!response.ok) {
      const error = new Error('R2 ' + method + ' failed for object (HTTP ' + response.status + ').');
      error.status = response.status;
      error.code = 'R2_OBJECT_REQUEST_FAILED';
      throw error;
    }
    return response;
  }

  return Object.freeze({
    backend: 'r2',
    configured,
    bucket: normalizedBucket,
    publicBaseUrl: normalizedPublicBaseUrl,
    getObjectKey: mediaKeyFromPath,
    getMediaPath: mediaPathFromKey,
    resolveFilePath() {
      return null;
    },
    resolveWebPath(fileName) {
      const value = String(fileName || '');
      const key = mediaKeyFromPath(value.startsWith('/') ? value : '/media/' + value);
      return key ? mediaPathFromKey(key) : null;
    },
    resolvePublicUrl(mediaPath, baseUrl = normalizedPublicBaseUrl) {
      const key = mediaKeyFromPath(mediaPath);
      const base = String(baseUrl || '').trim().replace(/\/$/, '');
      return key && base ? base + mediaPathFromKey(key) : null;
    },
    createPresignedGetUrl(mediaPath, options = {}) {
      const key = mediaKeyFromPath(mediaPath);
      return key ? signedUrl('GET', key, options) : null;
    },
    createPresignedPutUrl(key, options = {}) {
      return signedUrl('PUT', key, options);
    },
    async putBuffer(key, buffer, { contentType = 'application/octet-stream' } = {}) {
      await requestObject('PUT', key, {
        headers: { 'Content-Type': contentType },
        body: buffer,
      });
      return { key, sizeBytes: Buffer.byteLength(buffer), contentType };
    },
    async headObject(key) {
      const response = await requestObject('HEAD', key);
      return {
        sizeBytes: Number(response.headers.get('content-length') || 0),
        contentType: response.headers.get('content-type') || '',
        etag: response.headers.get('etag') || '',
      };
    },
    async getBuffer(mediaPath) {
      const key = mediaKeyFromPath(mediaPath);
      if (!key) throw new Error('R2 media path is invalid.');
      const response = await requestObject('GET', key);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(mediaPath) {
      const key = mediaKeyFromPath(mediaPath);
      if (!key) return false;
      await requestObject('DELETE', key);
      return true;
    },
    createUploadSession({ clientId = 'default', originalName = 'upload', mimeType = 'application/octet-stream', sizeBytes = 0, mediaId = createMediaId() } = {}) {
      const date = isoDate(now());
      const clientSegment = safeFilename(clientId).slice(0, 80) || 'default';
      const objectKey = 'original/' + clientSegment + '/' + date.toISOString().slice(0, 7).replace('-', '/') + '/' + mediaId + '/' + safeFilename(originalName);
      const mediaPath = mediaPathFromKey(objectKey);
      const uploadUrl = signedUrl('PUT', objectKey);
      const expiresAt = new Date(date.getTime() + ttl * 1000).toISOString();
      return {
        mediaId,
        objectKey,
        mediaPath,
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        expiresAt,
        sizeBytes: Number(sizeBytes) || 0,
        mimeType,
      };
    },
  });
}
