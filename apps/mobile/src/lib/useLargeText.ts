import { useWindowDimensions } from "react-native";

import { LARGE_TEXT_FONT_SCALE } from "./layout";

/** Accessibility text sizes: layouts stack values under labels and wrap names instead of cutting them. */
export function useLargeText() {
  return useWindowDimensions().fontScale >= LARGE_TEXT_FONT_SCALE;
}
