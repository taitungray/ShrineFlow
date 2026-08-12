import path from 'node:path';
import multer from 'multer';
import { directories } from './store.js';

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, directories.uploads),
  filename: (_request, file, callback) => {
    const safeName = path.basename(file.originalname).replace(/[^\w.\-\u00C0-\uFFFF]+/g, '_');
    callback(null, Date.now() + '-' + (safeName || 'image'));
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      callback(null, true);
    } else {
      callback(new Error('目前只接受圖片或影片檔案。'));
    }
  },
});

export function resolvePostMediaPaths(post) {
  const mediaPaths = Array.isArray(post.mediaPaths) && post.mediaPaths.length
    ? post.mediaPaths
    : (post.imagePath ? [post.imagePath] : []);
  return mediaPaths
    .filter((mediaPath) => String(mediaPath).startsWith('/uploads/'))
    .map((mediaPath) => path.join(directories.uploads, path.basename(String(mediaPath))));
}
