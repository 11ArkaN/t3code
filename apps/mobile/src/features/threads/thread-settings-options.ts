import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@t3tools/client-runtime/model-traits";
import type {
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  RuntimeMode,
} from "@t3tools/contracts";

import { applyProviderOptionSelection } from "../../lib/providerOptions";

export const RUNTIME_MODE_CHOICES: ReadonlyArray<{
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    mode: "auto",
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    mode: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
];

export function runtimeModeChoicesForSupportedModes(
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
) {
  return supportedRuntimeModes && supportedRuntimeModes.length > 0
    ? RUNTIME_MODE_CHOICES.filter((choice) => supportedRuntimeModes.includes(choice.mode))
    : RUNTIME_MODE_CHOICES;
}

export function compatibleRuntimeModeForChoices(
  runtimeMode: RuntimeMode,
  choices: ReadonlyArray<{ readonly mode: RuntimeMode }>,
): RuntimeMode {
  return choices.some((choice) => choice.mode === runtimeMode)
    ? runtimeMode
    : (choices[0]?.mode ?? runtimeMode);
}

export { selectableProviderOptionChoices as selectableChoices } from "@t3tools/client-runtime/model-traits";

/** What one trait pick writes. `options` is null when the pick only edits the prompt (Ultrathink). */
export function resolveTraitPick(input: {
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly prompt: string;
  readonly id: string;
  readonly value: string | boolean;
}): {
  readonly prompt: string;
  readonly options: ReadonlyArray<ProviderOptionSelection> | null;
} | null {
  const descriptor = input.descriptors.find((entry) => entry.id === input.id);
  if (descriptor?.type === "select") {
    if (typeof input.value !== "string") return null;
    const change = getTraitSelectChange(
      {
        ...getPromptControlledTraits(input.descriptors, input.prompt),
        descriptors: input.descriptors,
      },
      descriptor,
      input.prompt,
      input.value,
    );
    if (!change) return null;
    return {
      prompt: change.prompt,
      options: "modelOptions" in change ? (change.modelOptions ?? []) : null,
    };
  }
  const options = applyProviderOptionSelection(input.descriptors, {
    id: input.id,
    value: input.value,
  });
  return options ? { prompt: input.prompt, options } : null;
}

// Below this width the iOS composer folds Traits into the model chip.
const WIDE_COMPOSER_MIN_WIDTH = 520;
// Accessibility text sizes, the same point where list rows stack their detail.
const LARGE_TEXT_FONT_SCALE = 1.5;

/** The iOS composer's chips: model first, then Traits and Mode, in desktop order. */
export function resolveComposerControlsPresentation(input: {
  readonly width: number;
  readonly fontScale: number;
  readonly modelName: string;
  readonly traitsLabel: string;
  readonly runtimeMode: RuntimeMode;
  readonly defaultRuntimeMode: RuntimeMode;
}) {
  const wide = input.width >= WIDE_COMPOSER_MIN_WIDTH;
  const largeText = input.fontScale >= LARGE_TEXT_FONT_SCALE;
  return {
    // Large text wraps the row, and drops the folded effort, so the model name keeps its room.
    wraps: largeText,
    // One string: when it truncates, the effort at its tail goes before the model name.
    modelLabel:
      !wide && !largeText && input.traitsLabel.length > 0
        ? `${input.modelName} · ${input.traitsLabel}`
        : input.modelName,
    showsTraits: wide && input.traitsLabel.length > 0,
    showsMode: wide || input.runtimeMode !== input.defaultRuntimeMode,
  };
}
