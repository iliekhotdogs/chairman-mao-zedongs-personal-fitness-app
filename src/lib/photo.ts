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

/** A photo read from this device, ready to upload. */
export interface LocalPhoto {
  /** Blob on web; raw bytes on Android/iOS, where Blob uploads arrive empty. */
  body: Blob | Uint8Array;
  size: number;
}

/**
 * Read a photo stored on THIS device for upload, or undefined when it is not here: records
 * synced from another device carry that device's paths (a phone's file:// uri on the web,
 * or a file the OS has since removed). Those are skipped quietly; their own device uploads them.
 *  - Web: data: (thumbnails) and blob: URLs, read as a Blob.
 *  - Native: data: URLs are decoded; file:// and content:// files are read with
 *    expo-file-system as bytes (Supabase Storage cannot upload React Native Blobs).
 */
export async function readLocalPhoto(uri: string): Promise<LocalPhoto | undefined> {
  if (Platform.OS === 'web') {
    if (!uri.startsWith('data:') && !uri.startsWith('blob:')) return undefined;
    try {
      const blob = await (await fetch(uri)).blob();
      return { body: blob, size: blob.size };
    } catch {
      return undefined; // a blob: URL from an earlier page load is gone
    }
  }
  if (uri.startsWith('data:')) {
    const bytes = dataUrlBytes(uri);
    return bytes ? { body: bytes, size: bytes.byteLength } : undefined;
  }
  if (!uri.startsWith('file:') && !uri.startsWith('content:')) return undefined;
  const { File } = await import('expo-file-system');
  const file = new File(uri);
  if (!file.exists) return undefined;
  const bytes = await file.bytes();
  return { body: bytes, size: bytes.byteLength };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes of a base64 `data:` URL, or undefined if it is not one. */
export function dataUrlBytes(uri: string): Uint8Array | undefined {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(uri);
  if (!m) return undefined;
  const text = m[1].replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let n = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch === '-' ? '+' : ch === '_' ? '/' : ch);
    if (v < 0) return undefined;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (value >> bits) & 0xff;
      value &= (1 << bits) - 1;
    }
  }
  return out.subarray(0, n);
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
