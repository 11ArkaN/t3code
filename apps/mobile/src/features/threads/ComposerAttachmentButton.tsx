import type { MenuAction } from "@react-native-menu/menu";
import { Pressable } from "react-native";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { cn } from "../../lib/cn";

const ATTACHMENT_MENU_ACTIONS: MenuAction[] = [
  { id: "photos", title: "Photo Library", image: "photo" },
  { id: "files", title: "Choose Files", image: "folder" },
];

export function ComposerAttachmentButton(props: {
  readonly disabled?: boolean;
  readonly size?: "regular" | "large";
  /** Shown beside the icon where a bare "+" would not say what it adds. */
  readonly label?: string;
  readonly supportsFiles: boolean;
  readonly onPickMedia: () => Promise<void>;
  readonly onPickFiles: () => Promise<void>;
}) {
  const { scale } = useAndroidControlSizing();
  const button = (
    <Pressable
      accessibilityLabel={props.label ?? "Add attachment"}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className={cn(
        "h-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50",
        props.label ? "flex-row gap-1.5 self-start pl-2.5 pr-3.5" : "w-[44px]",
      )}
      disabled={props.disabled}
      onPress={props.supportsFiles ? undefined : () => void props.onPickMedia()}
    >
      <SymbolView
        name="plus"
        size={Math.round((props.size === "large" ? 26 : 20) * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
      {props.label ? (
        <AppText className="font-t3-medium text-sm text-foreground">{props.label}</AppText>
      ) : null}
    </Pressable>
  );

  if (props.disabled || !props.supportsFiles) {
    return button;
  }

  return (
    <Menu
      accessible
      accessibilityLabel={props.label ?? "Add attachment"}
      accessibilityRole="button"
      actions={ATTACHMENT_MENU_ACTIONS}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "photos") {
          void props.onPickMedia();
        } else if (nativeEvent.event === "files") {
          void props.onPickFiles();
        }
      }}
    >
      {button}
    </Menu>
  );
}
