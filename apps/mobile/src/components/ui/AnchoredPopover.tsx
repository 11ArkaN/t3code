import { Popover, RNHostView, Spacer, VStack } from "@expo/ui/swift-ui";
import { accessibilityHidden, frame, presentationBackground } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { NativeThemeHost } from "./NativeThemeHost";
import { useControlTheme } from "./useControlTheme";

/**
 * A native popover that points at the view it renders in, like desktop's. Mount it inside the
 * control that opened it while open; a dismissal calls `onClose`. Without a height it takes its
 * content's height.
 */
export function AnchoredPopover(props: {
  readonly width: number;
  readonly height?: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { colors } = useControlTheme();
  const { width, height } = props;
  return (
    <NativeThemeHost style={StyleSheet.absoluteFill}>
      <Popover
        isPresented
        onIsPresentedChange={(presented) => {
          if (!presented) props.onClose();
        }}
      >
        <Popover.Trigger>
          <Spacer
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), accessibilityHidden()]}
          />
        </Popover.Trigger>
        <Popover.Content>
          <VStack
            modifiers={[
              frame({ width, height }),
              presentationBackground(colors["--color-sheet-solid"]),
            ]}
          >
            <RNHostView matchContents={height === undefined ? { vertical: true } : false}>
              <View style={{ width, height }}>{props.children}</View>
            </RNHostView>
          </VStack>
        </Popover.Content>
      </Popover>
    </NativeThemeHost>
  );
}
