export function currentPostVersion(post = {}) {
  const version = Number(post.version);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

export function bumpPostVersion(post, updatedAt = new Date().toISOString()) {
  post.version = currentPostVersion(post) + 1;
  post.updatedAt = updatedAt;
  return post.version;
}
