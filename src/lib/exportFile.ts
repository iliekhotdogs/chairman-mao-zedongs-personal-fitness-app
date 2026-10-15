import { Platform } from 'react-native';

import type { ExportFile } from './export';

/**
 * Save an export as a real file.
 *  - Web: a Blob download.
 *  - Native: written to the cache folder with expo-file-system, then handed to the
 *    system share sheet (expo-sharing) so the user can save it to Files, Drive, email…
 */
export async function saveExportFile(file: ExportFile): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([file.content], { type: `${file.mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Revoke after the click has been processed, or some browsers cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  const out = new File(Paths.cache, file.filename);
  if (out.exists) out.delete();
  out.create();
  out.write(file.content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(out.uri, {
    mimeType: file.mimeType,
    UTI: file.mimeType === 'application/json' ? 'public.json' : 'public.comma-separated-values-text',
    dialogTitle: 'FitCoach data export',
  });
}
