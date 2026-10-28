import { useState } from "react";
import {
  Platform,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputInstance,
  type TextInputProps as RNTextInputProps,
  type TextProps as RNTextProps,
} from "react-native";

import { breaksInsideWord } from "../../lib/layout";
import { MOBILE_TEXT_CLASSES } from "../../lib/typography";
import { useLargeText } from "../../lib/useLargeText";

import { cn } from "../../lib/cn";

export type AppTextProps = RNTextProps & {
  readonly className?: string;
  readonly textRole?: keyof typeof MOBILE_TEXT_CLASSES;
};

export function AppText({ className, textRole, ...props }: AppTextProps) {
  return (
    <RNText
      className={cn(
        "font-sans text-foreground",
        textRole && MOBILE_TEXT_CLASSES[textRole],
        className,
      )}
      selectionColorClassName={Platform.OS === "android" ? "accent-focus/32" : undefined}
      {...props}
    />
  );
}

/**
 * A short label, such as a row or section name, that wraps only between words. At accessibility
 * sizes a word wider than its line shrinks the label instead of breaking ("Environme/nts").
 */
export function LabelText({ children, ...props }: AppTextProps & { readonly children: string }) {
  const largeText = useLargeText();
  // The label whose packed lines split a word; it then gets one word per line, so the split
  // word overflows the line count and shrinks.
  const [splitLabel, setSplitLabel] = useState<string | null>(null);
  if (!largeText) return <AppText {...props}>{children}</AppText>;
  const words = children.trim().split(/\s+/);
  const oneWordPerLine = splitLabel === children;
  return (
    <AppText
      {...props}
      adjustsFontSizeToFit
      numberOfLines={words.length}
      onTextLayout={
        words.length > 1 && !oneWordPerLine
          ? (event) => {
              if (breaksInsideWord(event.nativeEvent.lines.map((line) => line.text))) {
                setSplitLabel(children);
              }
            }
          : undefined
      }
    >
      {oneWordPerLine ? words.join("\n") : children}
    </AppText>
  );
}

export type AppTextInputProps = Omit<RNTextInputProps, "placeholderTextColor"> & {
  readonly className?: string;
  readonly ref?: React.Ref<TextInputInstance>;
};

export function AppTextInput({ className, ref, ...props }: AppTextInputProps) {
  return (
    <RNTextInput
      ref={ref}
      className={cn(
        "min-h-13.5 rounded-2xl border border-input-border bg-input px-3.5 py-3 font-sans text-base text-foreground",
        className,
      )}
      placeholderTextColorClassName="accent-placeholder"
      selectionColorClassName={"accent-focus/32"}
      cursorColorClassName={"accent-focus"}
      selectionHandleColorClassName={Platform.OS === "android" ? "accent-focus" : undefined}
      {...props}
    />
  );
}
