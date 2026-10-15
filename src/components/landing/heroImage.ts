import type { ImageSourcePropType } from 'react-native';

/**
 * Optional hero photo for the landing page.
 *
 * No photo ships yet, so the hero renders a monochrome SVG treatment instead. To add one, drop a
 * wide, dark-ish photo (≥ 2000px, subject on the right) at `assets/images/hero.jpg` and change this to:
 *
 *   export const HERO_IMAGE: ImageSourcePropType | undefined = require('../../../assets/images/hero.jpg');
 *
 * It is shown desaturated with a dark gradient over it so text stays readable.
 */
export const HERO_IMAGE: ImageSourcePropType | undefined = undefined;
