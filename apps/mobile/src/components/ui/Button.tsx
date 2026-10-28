import { SymbolView, type AppSymbolName } from "./AppSymbol";
import { Pressable } from "react-native";
import { AppActivityIndicator } from "./AppActivityIndicator";
import { AppText } from "./AppText";
import { cn } from "../../lib/cn";

export interface ButtonProps {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly icon?: AppSymbolName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly loading?: boolean;
  readonly tone?: "primary" | "secondary" | "danger" | "text" | "contrast";
  readonly fullWidth?: boolean;
}

const TONE_CLASS_NAMES = {
  contrast: ["bg-foreground", "text-screen"],
  primary: ["bg-primary", "text-primary-foreground"],
  secondary: ["bg-secondary", "text-secondary-foreground"],
  danger: ["bg-danger", "text-danger-foreground"],
  text: ["bg-transparent", "text-primary-text"],
} as const;

export function Button(props: ButtonProps) {
  const tone = props.tone ?? "secondary";
  const [containerClassName, labelClassName] = TONE_CLASS_NAMES[tone];
  const disabled = Boolean(props.disabled || props.loading);
  // Dark cards share the grey fill, so a greyed primary reads as plain text; dim it like desktop.
  const greyed = disabled && tone !== "primary";
  const accentClassName = greyed
    ? "accent-foreground-muted"
    : labelClassName.replace("text-", "accent-");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ disabled, busy: Boolean(props.loading) }}
      disabled={disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-12 flex-row items-center justify-center gap-2 rounded-full px-6 active:opacity-70",
        props.fullWidth ? "w-full" : "self-start",
        greyed ? "bg-subtle-strong" : containerClassName,
        disabled && !greyed && "opacity-50",
      )}
    >
      {props.loading ? (
        <AppActivityIndicator colorClassName={accentClassName} />
      ) : props.icon ? (
        <SymbolView name={props.icon} size={18} tintColorClassName={accentClassName} />
      ) : null}
      <AppText
        className={cn(
          "min-w-0 shrink text-center font-t3-medium",
          greyed ? "text-foreground-muted" : labelClassName,
        )}
      >
        {props.label}
      </AppText>
    </Pressable>
  );
}
