import type { ReactNode } from "react";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { ScreenFade } from "../../components/ScreenFade";
import { useComposerPopoverHost } from "./ComposerPopoverHost";

const POPOVER_GAP = 8;
// The composer's horizontal padding, so the ground meets the composer block's edges.
const COMPOSER_GUTTER = 12;

/** Opens above the whole composer block, so the docked run status and stacked cards stay visible. */
export function ComposerPopoverAnchor(props: { readonly children: ReactNode }) {
  const host = useComposerPopoverHost();
  const popoverHeight = host?.popoverHeight;
  const composerOffset = host?.composerOffset;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets the popover host's shared height value when the anchor unmounts
  useEffect(
    () => () => {
      popoverHeight?.set(0);
    },
    [popoverHeight],
  );
  const offsetStyle = useAnimatedStyle(() => ({
    marginBottom: POPOVER_GAP + (composerOffset?.value ?? 0),
  }));
  return (
    <Animated.View
      className="absolute inset-x-0 bottom-full z-10"
      style={offsetStyle}
      onLayout={(event) => {
        popoverHeight?.set(event.nativeEvent.layout.height);
      }}
    >
      {/* Screen-colored ground down to the composer block, so no message reads through the gap,
        and a fade above, so messages dissolve instead of being cut by the popover's edge. */}
      <View
        pointerEvents="none"
        className="absolute bg-screen"
        style={{ top: 0, bottom: -POPOVER_GAP, left: -COMPOSER_GUTTER, right: -COMPOSER_GUTTER }}
      >
        <ScreenFade
          opaqueEdge="bottom"
          style={{ position: "absolute", bottom: "100%", left: 0, right: 0, height: 24 }}
        />
      </View>
      {props.children}
    </Animated.View>
  );
}
