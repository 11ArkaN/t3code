const PENDING_USER_INPUT_MIN_HEIGHT = 160;
const PENDING_USER_INPUT_VERTICAL_GAP = 12;

export const ESTIMATED_KEYBOARD_HEIGHT = 336;

/** Card transitions and feed insets must share timing to avoid drift. */
export const USER_INPUT_TOGGLE_DURATION_MS = 220;

/** The card may grow up to the header; it scrolls only when its content needs more. */
export function derivePendingUserInputMaxHeight(input: {
  readonly windowHeight: number;
  readonly keyboardHeight: number;
  readonly navigationHeaderHeight: number;
  readonly composerOverlapHeight: number;
}): number {
  "worklet";
  const availableHeight =
    input.windowHeight -
    Math.max(0, input.keyboardHeight) -
    Math.max(0, input.navigationHeaderHeight) -
    Math.max(0, input.composerOverlapHeight) -
    PENDING_USER_INPUT_VERTICAL_GAP;

  return Math.max(PENDING_USER_INPUT_MIN_HEIGHT, availableHeight);
}
