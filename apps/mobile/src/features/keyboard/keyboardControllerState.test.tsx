import { act } from "react";
import { createRoot } from "react-dom/client";
import type { KeyboardEventData } from "react-native-keyboard-controller";
import { expect, it, vi } from "vite-plus/test";

const listeners = vi.hoisted(() => new Map<string, Set<(event: KeyboardEventData) => void>>());

// Exercises the patched library source with only its native bindings replaced.
vi.mock("react-native-keyboard-controller/src/bindings", () => ({
  KeyboardEvents: {
    addListener: (name: string, listener: (event: KeyboardEventData) => void) => {
      const named = listeners.get(name) ?? new Set();
      named.add(listener);
      listeners.set(name, named);
      return { remove: () => named.delete(listener) };
    },
  },
  KeyboardControllerNative: { dismiss: () => {} },
}));

import { useKeyboardState } from "react-native-keyboard-controller/src/hooks/useKeyboardState";
import { KeyboardController } from "react-native-keyboard-controller/src/module";

function emit(name: string, height: number) {
  const event: KeyboardEventData = {
    height,
    duration: 0,
    timestamp: 1,
    target: 42,
    type: "default",
    appearance: "light",
  };
  act(() => {
    for (const listener of listeners.get(name) ?? []) listener(event);
  });
}

function KeyboardState() {
  const { isVisible, height } = useKeyboardState();
  return <output>{JSON.stringify({ isVisible, height })}</output>;
}

function setup() {
  emit("keyboardDidHide", 0);
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<KeyboardState />));
  return {
    container,
    [Symbol.dispose]() {
      act(() => root.unmount());
      emit("keyboardDidHide", 0);
    },
  };
}

// Android's syncKeyboardPosition repairs a nonanimated IME inset change with
// keyboardDidHide then keyboardDidShow, and no keyboardWillShow.
it("reports the keyboard shown after Android repairs the IME inset without keyboardWillShow", () => {
  using screen = setup();

  emit("keyboardDidShow", 376);

  expect({
    isVisible: KeyboardController.isVisible(),
    height: KeyboardController.state().height,
    hook: JSON.parse(screen.container.textContent ?? ""),
  }).toEqual({ isVisible: true, height: 376, hook: { isVisible: true, height: 376 } });
});

it("waits for the native hide before dismiss resolves after a didShow-only repair", async () => {
  using _screen = setup();
  emit("keyboardDidShow", 376);

  let dismissed = false;
  const dismissal = KeyboardController.dismiss().then(() => {
    dismissed = true;
  });
  await act(async () => {});

  expect({ dismissedBeforeNativeHide: dismissed }).toEqual({ dismissedBeforeNativeHide: false });
  emit("keyboardDidHide", 0);
  await dismissal;
});
