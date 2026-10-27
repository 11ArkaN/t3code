import { expect, it, vi } from "vite-plus/test";

const listeners = vi.hoisted(() => new Map<string, Set<() => void>>());

vi.mock("react-native-keyboard-controller", () => ({
  KeyboardController: { isVisible: () => false },
  KeyboardEvents: {
    addListener: (name: string, listener: () => void) => {
      const named = listeners.get(name) ?? new Set();
      named.add(listener);
      listeners.set(name, named);
      return { remove: () => named.delete(listener) };
    },
  },
}));

import { getKeyboardShowing, subscribeKeyboardShowing } from "./terminalKeyboardShowing";

function emit(name: string) {
  for (const listener of listeners.get(name) ?? []) listener();
}

// Android's syncKeyboardPosition repairs a nonanimated IME inset change with
// keyboardDidHide then keyboardDidShow, and no keyboardWillShow.
it("brings the accessory back when Android restores the keyboard with keyboardDidShow alone", () => {
  const onChange = vi.fn();
  const unsubscribe = subscribeKeyboardShowing(onChange);
  emit("keyboardWillShow");
  emit("keyboardWillHide");
  emit("keyboardDidHide");
  onChange.mockClear();

  emit("keyboardDidShow");

  expect({ showing: getKeyboardShowing(), notified: onChange.mock.calls.length }).toEqual({
    showing: true,
    notified: 1,
  });
  unsubscribe();
});
