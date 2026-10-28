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

import { getKeyboardShowEpoch, subscribeKeyboardShowing } from "./terminalKeyboardShowing";

function emit(name: string) {
  for (const listener of listeners.get(name) ?? []) listener();
}

// Android's syncKeyboardPosition repairs a nonanimated IME inset change with
// keyboardDidHide then keyboardDidShow, and no will-events.
it("keeps the accessory through Android's did-only repair and starts a new show after it", () => {
  const onChange = vi.fn();
  const unsubscribe = subscribeKeyboardShowing(onChange);
  const trace = ["keyboardWillShow", "keyboardDidShow", "keyboardDidHide", "keyboardDidShow"].map(
    (name) => {
      emit(name);
      return getKeyboardShowEpoch();
    },
  );
  emit("keyboardWillHide");

  const [shown, settled, repairHidden, repairShown] = trace;
  expect({
    neverHidden: trace.every((epoch) => epoch !== 0),
    sameShow: settled === shown && repairHidden === shown,
    newShow: repairShown !== shown,
    hiddenAfterWillHide: getKeyboardShowEpoch(),
    notified: onChange.mock.calls.length,
  }).toEqual({
    neverHidden: true,
    sameShow: true,
    newShow: true,
    hiddenAfterWillHide: 0,
    notified: 3,
  });
  unsubscribe();
});
