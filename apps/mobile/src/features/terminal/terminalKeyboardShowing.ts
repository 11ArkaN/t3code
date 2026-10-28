import { KeyboardController, KeyboardEvents } from "react-native-keyboard-controller";

// `useKeyboardState` only flips to hidden on didHide; the accessory must
// leave as soon as the keyboard starts hiding, so it follows the will-events.
// Android shows and hides a nonanimated IME inset with the did-events alone.
let keyboardShowing = KeyboardController.isVisible();
export function subscribeKeyboardShowing(onChange: () => void) {
  keyboardShowing = KeyboardController.isVisible();
  const show = () => {
    keyboardShowing = true;
    onChange();
  };
  const willShow = KeyboardEvents.addListener("keyboardWillShow", show);
  const didShow = KeyboardEvents.addListener("keyboardDidShow", show);
  const hide = () => {
    keyboardShowing = false;
    onChange();
  };
  const willHide = KeyboardEvents.addListener("keyboardWillHide", hide);
  const didHide = KeyboardEvents.addListener("keyboardDidHide", hide);
  return () => {
    willShow.remove();
    didShow.remove();
    willHide.remove();
    didHide.remove();
  };
}
export const getKeyboardShowing = () => keyboardShowing;
