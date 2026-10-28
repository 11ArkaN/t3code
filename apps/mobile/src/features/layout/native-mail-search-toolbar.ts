import { useWindowDimensions } from "react-native";
import type { HeaderBarButtonMailSearchToolbarItem } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";

export const NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED = NATIVE_LIQUID_GLASS_SUPPORTED;

export const NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET = 56;

/** The inset at the current text size: UIKit grows the search field with its 17pt body text. */
export function useNativeMailSearchToolbarContentInset(): number {
  const { fontScale } = useWindowDimensions();
  return NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET + Math.max(0, fontScale - 1) * 17;
}

type NativeMailSearchToolbarInput = Omit<
  HeaderBarButtonMailSearchToolbarItem,
  "type" | "useFallbackSearchField"
>;

export function createNativeMailSearchToolbarItem(
  input: NativeMailSearchToolbarInput,
): HeaderBarButtonMailSearchToolbarItem {
  return {
    placeholder: "Search",
    ...input,
    type: "mailSearchToolbar",
    useFallbackSearchField: true,
  };
}
