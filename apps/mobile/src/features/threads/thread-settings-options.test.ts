import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveComposerControlsPresentation,
  resolveTraitPick,
  selectableChoices,
} from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  // regression: #21406 bring model controls in line with web
  it("includes prompt-injected and workflow choices in declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
      "ultrathink",
      "ultracode",
    ]);
  });
});

describe("prompt-controlled reasoning", () => {
  it("adds Ultrathink to the prompt without persisting an injected option", () => {
    const descriptors = [effortDescriptor];
    const change = getTraitSelectChange(
      { ...getPromptControlledTraits(descriptors, "solve it"), descriptors },
      effortDescriptor,
      "solve it",
      "ultrathink",
    );
    expect(change).toEqual({ prompt: "Ultrathink:\nsolve it" });
    expect(
      getPromptControlledTraits(descriptors, change?.prompt ?? "").ultrathinkPromptControlled,
    ).toBe(true);
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, ""), descriptors },
        effortDescriptor,
        "",
        "ultrathink",
      ),
    ).toEqual({ prompt: "Ultrathink:\n" });
  });

  it("removes the prefix when choosing a regular effort and saves Ultracode as an option", () => {
    const descriptors = [effortDescriptor];
    const prompt = "Ultrathink:\nsolve it";
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, prompt), descriptors },
        effortDescriptor,
        prompt,
        "ultracode",
      ),
    ).toEqual({ prompt: "solve it", modelOptions: [{ id: "effort", value: "ultracode" }] });
  });

  it("keeps body-controlled Ultrathink locked and preserves slash commands", () => {
    const descriptors = [effortDescriptor];
    const prompt = "please ultrathink about this";
    const selected = { ...getPromptControlledTraits(descriptors, prompt), descriptors };
    expect(selected.ultrathinkInBodyText).toBe(true);
    expect(getTraitSelectChange(selected, effortDescriptor, prompt, "low")).toBeNull();
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, "/review"), descriptors },
        effortDescriptor,
        "/review",
        "ultrathink",
      ),
    ).toEqual({ prompt: "/review" });
  });
});

describe("resolveTraitPick", () => {
  const fastDescriptor: ProviderOptionDescriptor = {
    id: "fastMode",
    label: "Fast mode",
    type: "boolean",
    currentValue: false,
  };
  const descriptors = [effortDescriptor, fastDescriptor];

  it("writes options for a regular pick and only the prompt for Ultrathink", () => {
    expect(resolveTraitPick({ descriptors, prompt: "fix it", id: "effort", value: "low" })).toEqual(
      {
        prompt: "fix it",
        options: [
          { id: "effort", value: "low" },
          { id: "fastMode", value: false },
        ],
      },
    );
    expect(
      resolveTraitPick({ descriptors, prompt: "fix it", id: "effort", value: "ultrathink" }),
    ).toEqual({ prompt: "Ultrathink:\nfix it", options: null });
    expect(
      resolveTraitPick({ descriptors, prompt: "fix it", id: "fastMode", value: true })?.options,
    ).toContainEqual({ id: "fastMode", value: true });
  });

  it("ignores picks the descriptor cannot take", () => {
    const pick = (id: string, value: string | boolean, prompt = "fix it") =>
      resolveTraitPick({ descriptors, prompt, id, value });
    expect(pick("effort", true)).toBeNull();
    expect(pick("missing", "low")).toBeNull();
    expect(pick("effort", "low", "please ultrathink about this")).toBeNull();
  });
});

describe("resolveComposerControlsPresentation", () => {
  const phone = {
    width: 360,
    fontScale: 1,
    modelName: "Opus 5.5",
    traitsLabel: "High",
    runtimeMode: "full-access",
    defaultRuntimeMode: "full-access",
  } as const;

  it("folds effort into the model chip on a phone and splits it out on wide screens", () => {
    expect(resolveComposerControlsPresentation(phone)).toEqual({
      wraps: false,
      modelLabel: "Opus 5.5 · High",
      showsTraits: false,
      showsMode: false,
    });
    expect(resolveComposerControlsPresentation({ ...phone, width: 700 })).toEqual({
      wraps: false,
      modelLabel: "Opus 5.5",
      showsTraits: true,
      showsMode: true,
    });
    expect(resolveComposerControlsPresentation({ ...phone, traitsLabel: "" }).modelLabel).toBe(
      "Opus 5.5",
    );
  });

  it("shows Mode on a phone only when it differs from the default", () => {
    expect(
      resolveComposerControlsPresentation({ ...phone, runtimeMode: "approval-required" }).showsMode,
    ).toBe(true);
    expect(
      resolveComposerControlsPresentation({
        ...phone,
        runtimeMode: "approval-required",
        defaultRuntimeMode: "approval-required",
      }).showsMode,
    ).toBe(false);
  });

  it("wraps at accessibility text sizes and keeps the whole model name", () => {
    expect(resolveComposerControlsPresentation({ ...phone, fontScale: 3.5 })).toMatchObject({
      wraps: true,
      modelLabel: "Opus 5.5",
    });
  });
});
