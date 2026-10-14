import { Platform } from 'react-native';

import { log } from './log';

/**
 * Make a meal photo safe to keep in the food log.
 *  - Web: picker URIs are temporary blob:/data: URLs and browser storage is small (~5 MB),
 *    so a small JPEG thumbnail (≈20 KB) is stored instead of the full photo.
 *  - Android: the picker returns a file in the cache folder, which the OS may clear, so it is
 *    copied into the app's documents folder.
 * Returns undefined if the photo can't be kept; the meal is still logged without it.
 * Progress photos use the same pipeline with their own folder and a larger web thumbnail.
 */
export async function persistPhoto(uri: string | undefined, id: string, opts: { folder?: string; webMaxSize?: number } = {}): Promise<string | undefined> {
  if (!uri) return undefined;
  try {
    if (Platform.OS === 'web') return await webThumbnail(uri, opts.webMaxSize ?? 360, 0.7);
    const { File, Directory, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, opts.folder ?? 'meal-photos');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `${id}.jpg`);
    await new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return Platform.OS === 'web' ? undefined : uri;
  }
}

/** Remove a photo file this app copied into its documents folder (no-op for web/cloud URIs). */
export async function discardLocalPhoto(uri: string | undefined): Promise<void> {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const { File } = await import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch (e) {
    log.warn('photo', 'Could not remove a local photo file.', e);
  }
}

function webThumbnail(uri: string, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = uri;
  });
}
