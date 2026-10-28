import type { RuntimeMode } from "@t3tools/contracts";
import { type ReactNode, useRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerHandleContext, type ComposerHandleRef } from "../../composerHandleContext";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import {
  focusRequestedPermission,
  markOpenToPermissions,
  useComposerMenuProps,
} from "./composerEventScope";
import { ComposerFooterModeControls, ComposerPermissionsSection } from "./ComposerFooterControls";
import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeConfig";

const options = runtimeModeOptions.map((mode) => ({ mode, ...runtimeModeConfig[mode] }));

// Mirrors the effort menu: effort radio items first, then the Permissions section.
function EffortMenu() {
  const [effort, setEffort] = useState("high");
  const [mode, setMode] = useState<RuntimeMode>("full-access");
  const composerMenuProps = useComposerMenuProps();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Menu onOpenChangeComplete={(open) => focusRequestedPermission(open, triggerRef.current)}>
        <MenuTrigger ref={triggerRef}>Effort</MenuTrigger>
        <MenuPopup {...composerMenuProps}>
          <MenuRadioGroup value={effort} onValueChange={setEffort}>
            <MenuRadioItem value="low">Low</MenuRadioItem>
            <MenuRadioItem value="high">High</MenuRadioItem>
          </MenuRadioGroup>
          <ComposerPermissionsSection
            runtimeMode={mode}
            runtimeModeOptions={options}
            onRuntimeModeChange={setMode}
          />
        </MenuPopup>
      </Menu>
      <p role="status">{mode}</p>
    </>
  );
}

it("reaches Permissions from the effort items with arrow keys, previews, and picks with Enter", async () => {
  await using screen = await render(<EffortMenu />, { router: false }); // no routes involved
  const trigger = screen.getByRole("button", { name: "Effort" });
  await userEvent.tab();
  await expect.element(trigger).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitemradio", { name: "Low" })).toHaveFocus();

  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  const supervised = page.getByRole("menuitemradio", { name: "Supervised" });
  await expect.element(supervised).toHaveFocus();
  await expect
    .element(supervised)
    .toHaveAccessibleDescription("Ask before commands and file changes.");

  await userEvent.keyboard("{ArrowRight}");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Auto-accept edits" }))
    .toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  await expect.element(page.getByRole("menuitemradio", { name: "Supervised" })).toHaveFocus();

  await userEvent.keyboard("{ArrowUp}");
  await expect.element(page.getByRole("menuitemradio", { name: "High" })).toHaveFocus();

  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  await expect.element(screen.getByRole("status")).toHaveTextContent("auto-accept-edits");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Supervised" }))
    .not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

it("marks the current mode as checked and closes on Escape", async () => {
  await using screen = await render(<EffortMenu />, { router: false }); // no routes involved
  await userEvent.tab();
  await userEvent.keyboard("{ArrowDown}");
  const fullAccess = page.getByRole("menuitemradio", { name: "Full access" });
  await expect.element(fullAccess).toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{Escape}");
  await expect.element(fullAccess).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Effort" })).toHaveFocus();
});

// The real composer menu focus rule (useComposerMenuProps), with a stub composer handle.
function withComposer(children: ReactNode) {
  const handle = { focusAtEnd: vi.fn() };
  const ref = { current: handle } as unknown as ComposerHandleRef;
  return { handle, ui: <ComposerHandleContext value={ref}>{children}</ComposerHandleContext> };
}

it("returns focus to the editor after a pick", async () => {
  const { handle, ui } = withComposer(<EffortMenu />);
  await using screen = await render(ui, { router: false }); // no routes involved
  await userEvent.tab();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitemradio", { name: "Low" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  await expect.element(screen.getByRole("status")).toHaveTextContent("approval-required");
  await vi.waitFor(() => expect(handle.focusAtEnd).toHaveBeenCalled());
});

// A tablet: Chromium's touch emulation makes (pointer: coarse) and (hover: none) match.
async function emulateTouchPrimaryDevice(): Promise<AsyncDisposable> {
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return {
    [Symbol.asyncDispose]: async () => {
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
    },
  };
}

it("leaves focus off the editor after a pick on a touch-primary device", async () => {
  await using _touch = await emulateTouchPrimaryDevice();
  expect(window.matchMedia("(pointer: coarse) and (hover: none)").matches).toBe(true);
  const ref = {
    current: { focusAtEnd: () => document.getElementById("composer-editor")?.focus() },
  } as unknown as ComposerHandleRef;
  await using screen = await render(
    <ComposerHandleContext value={ref}>
      <div id="composer-editor" contentEditable />
      <EffortMenu />
    </ComposerHandleContext>,
    { router: false }, // no routes involved
  );
  await userEvent.click(screen.getByRole("button", { name: "Effort" }));
  const supervised = page.getByRole("menuitemradio", { name: "Supervised" });
  await userEvent.click(supervised);
  await expect.element(screen.getByRole("status")).toHaveTextContent("approval-required");
  // The menu restores focus as it unmounts, so once it is gone focus has settled.
  await expect.element(supervised).not.toBeInTheDocument();
  // On a phone or tablet a focused editor raises the on-screen keyboard.
  expect(document.activeElement?.id, "closing a touch menu focused the composer editor").not.toBe(
    "composer-editor",
  );
});

it("opens on the checked permission when composer.mode marked the trigger", async () => {
  await using screen = await render(<EffortMenu />, { router: false }); // no routes involved
  const trigger = screen.getByRole("button", { name: "Effort" });
  markOpenToPermissions(trigger.element() as HTMLElement);
  await userEvent.click(trigger);
  await expect.element(page.getByRole("menuitemradio", { name: "Full access" })).toHaveFocus();

  // The mark is used once: a plain reopen lands on the menu's usual first focus.
  await userEvent.keyboard("{Escape}");
  await userEvent.click(trigger);
  await expect.element(page.getByRole("menuitemradio", { name: "Full access" })).not.toHaveFocus();
});

// Mirrors ComposerControlsBar: the chip shows only while the mode differs from the default.
function PermissionsChip() {
  const [mode, setMode] = useState<RuntimeMode>("approval-required");
  return (
    <div data-slot="composer-shell">
      <button type="button" data-composer-shortcut="composer.effort composer.mode">
        Effort
      </button>
      {mode === "full-access" ? null : (
        <ComposerFooterModeControls
          showInteractionModeToggle={false}
          interactionMode="default"
          runtimeMode={mode}
          runtimeModeOptions={options}
          accessDisplay="label"
          onToggleInteractionMode={() => {}}
          onRuntimeModeChange={setMode}
        />
      )}
    </div>
  );
}

it("returns focus to the editor when picking the default hides the chip", async () => {
  const { handle, ui } = withComposer(<PermissionsChip />);
  await using screen = await render(ui, { router: false }); // no routes involved
  await userEvent.click(screen.getByRole("button", { name: "Permissions: Supervised" }));
  await userEvent.click(page.getByRole("menuitemradio", { name: "Full access" }));
  await vi.waitFor(() => expect(handle.focusAtEnd).toHaveBeenCalled());
  await expect.element(screen.getByRole("button", { name: "Effort" })).not.toHaveFocus();
});
