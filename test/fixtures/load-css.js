import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Loads and resolves all @import statements in a CSS file recursively,
 * normalizing CRLF to LF.
 */
export async function loadCss(entryRelPath = 'public/style.css') {
  const entryPath = path.isAbsolute(entryRelPath) ? entryRelPath : path.join(root, entryRelPath);
  const content = (await fs.readFile(entryPath, 'utf8')).replace(/\r\n/g, '\n');
  const dir = path.dirname(entryPath);

  const importRegex = /@import\s+(?:url\(['"]?([^'")]+)['"]?\)|['"]([^'"]+)['"]);?/g;
  let resolved = content;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const rawTarget = match[1] || match[2];
    const importTarget = rawTarget.split('?')[0];
    const targetPath = path.resolve(dir, importTarget);
    const importedContent = await loadCss(targetPath);
    resolved = resolved.replace(match[0], importedContent);
  }

  return resolved.replace(/\r\n/g, '\n');
}
