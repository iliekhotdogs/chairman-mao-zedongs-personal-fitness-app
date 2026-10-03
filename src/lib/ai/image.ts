import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Shrinks a meal photo before it is sent to an AI model. Phone photos are several MB;
 * ~768 px is plenty to recognise food, uploads faster, costs less, and stays under
 * NVIDIA's inline image limit (~180 KB of base64).
 */
export async function prepareImageForAI(uri: string, size?: { width?: number; height?: number }): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  for (const [maxSide, compress] of [[768, 0.6], [512, 0.5]] as const) {
    const landscape = (size?.width ?? 1) >= (size?.height ?? 1);
    const ctx = ImageManipulator.manipulate(uri).resize(landscape ? { width: Math.min(maxSide, size?.width ?? maxSide) } : { height: Math.min(maxSide, size?.height ?? maxSide) });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ base64: true, compress, format: SaveFormat.JPEG });
    if (out.base64 && out.base64.length < 180_000) return { base64: out.base64, mediaType: 'image/jpeg' };
  }
  throw new Error('This photo could not be made small enough to send.');
}
