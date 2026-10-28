import type { ReactNode } from "react";
import { useEffect } from "react";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useComposerPopoverHost } from "./ComposerPopoverHost";

const POPOVER_GAP = 8;

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
      {props.children}
    </Animated.View>
  );
}
