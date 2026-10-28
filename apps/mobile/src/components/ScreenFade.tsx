import { View, type ViewStyle } from "react-native";

import { themeColorWithAlpha } from "../lib/mobileTheme";
import { useUniwindTheme } from "../lib/useUniwindTheme";

/**
 * A gradient from clear to the screen color at `opaqueEdge`. Uniwind's `bg-linear-*` classes draw
 * nothing on native (their stops reach React Native without colors), so this builds the style.
 */
export function ScreenFade(props: {
  readonly opaqueEdge: "top" | "bottom";
  readonly style: ViewStyle;
}) {
  const screen = useUniwindTheme()["--color-screen"];
  const direction = props.opaqueEdge === "bottom" ? "to bottom" : "to top";
  return (
    <View
      pointerEvents="none"
      style={[
        props.style,
        {
          experimental_backgroundImage: `linear-gradient(${direction}, ${themeColorWithAlpha(screen, 0)}, ${screen})`,
        },
      ]}
    />
  );
}
