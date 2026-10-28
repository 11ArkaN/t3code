import { Platform } from "react-native";
import {
  nativeHeaderScrollEdgeEffects,
  type AppNativeStackNavigationOptions,
} from "../../native/StackHeader";

export function threadHeaderAppearance(
  usesNativeHeaderGlass: boolean,
): AppNativeStackNavigationOptions {
  return {
    headerShown: true,
    headerTransparent: usesNativeHeaderGlass,
    headerStyle: usesNativeHeaderGlass ? { backgroundColor: "transparent" } : undefined,
    headerShadowVisible: false,
    // Hard, not the soft fade: code and messages scrolled under the title stayed legible behind it.
    scrollEdgeEffects: usesNativeHeaderGlass
      ? { ...nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version), top: "hard" }
      : undefined,
    headerTitleStyle: usesNativeHeaderGlass ? { fontSize: 17, fontWeight: "800" } : undefined,
    contentStyle: undefined,
  };
}
