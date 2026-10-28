import { KeyboardController, KeyboardEvents } from "react-native-keyboard-controller";

// The accessory leaves on willHide, before `useKeyboardState` sees didHide. Android
// repairs a nonanimated IME change with didHide then didShow alone: that didHide must
// not hide the accessory (it would clear the terminal's focus), but the didShow after
// it starts a new show so a dismissed accessory comes back.
let showEpoch = 1;
let keyboardShowing = KeyboardController.isVisible();
let hiddenWithoutWillHide = false;

export function subscribeKeyboardShowing(onChange: () => void) {
  keyboardShowing = KeyboardController.isVisible();
  hiddenWithoutWillHide = false;
  const show = () => {
    const repaired = hiddenWithoutWillHide;
    hiddenWithoutWillHide = false;
    if (!keyboardShowing || repaired) {
      keyboardShowing = true;
      showEpoch += 1;
    }
    onChange();
  };
  const willShow = KeyboardEvents.addListener("keyboardWillShow", show);
  const didShow = KeyboardEvents.addListener("keyboardDidShow", show);
  const willHide = KeyboardEvents.addListener("keyboardWillHide", () => {
    keyboardShowing = false;
    onChange();
  });
  const didHide = KeyboardEvents.addListener("keyboardDidHide", () => {
    hiddenWithoutWillHide = keyboardShowing;
  });
  return () => {
    willShow.remove();
    didShow.remove();
    willHide.remove();
    didHide.remove();
  };
}

// 0 while hidden; otherwise a number that changes with every new show.
export const getKeyboardShowEpoch = () => (keyboardShowing ? showEpoch : 0);
