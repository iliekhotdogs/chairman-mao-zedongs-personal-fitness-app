import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Shrinks a meal photo before it is sent to an AI model. Phone photos are several MB;
 * The pilot compares the current 768 px / 180 KB setting with a larger image.
 */
export type ImageSetting = 'current' | 'higher_resolution';
export async function prepareImageForAI(uri: string, size?: { width?: number; height?: number }, setting: ImageSetting = 'current'): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const attempts = setting === 'current' ? [[768, 0.6], [512, 0.5]] as const : [[1280, 0.75], [1024, 0.65]] as const;
  const limit = setting === 'current' ? 180_000 : 700_000;
  for (const [maxSide, compress] of attempts) {
    const landscape = (size?.width ?? 1) >= (size?.height ?? 1);
    const ctx = ImageManipulator.manipulate(uri).resize(landscape ? { width: Math.min(maxSide, size?.width ?? maxSide) } : { height: Math.min(maxSide, size?.height ?? maxSide) });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ base64: true, compress, format: SaveFormat.JPEG });
    if (out.base64 && out.base64.length < limit) return { base64: out.base64, mediaType: 'image/jpeg' };
  }
  throw new Error('This photo could not be made small enough to send.');
}
