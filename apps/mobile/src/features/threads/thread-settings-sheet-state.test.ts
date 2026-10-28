import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ProviderOptionSelection } from "@t3tools/contracts";

import type { ModelOption } from "../../lib/modelOptions";
import { canSelectModel } from "./thread-settings-sheet-state";

function modelOption(
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> = [],
): ModelOption {
  return {
    key: `codex:${model}`,
    label: model,
    subtitle: "",
    providerKey: "codex",
    providerLabel: "Codex",
    providerDriver: "codex",
    isDefault: false,
    isLegacy: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
          ],
          currentValue: "medium",
        },
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "priority", label: "Fast" },
          ],
          currentValue: "default",
        },
      ],
    },
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model,
      options,
    },
  };
}

describe("thread settings sheet state", () => {
  // regression: #16816 sync model favorites and visibility across clients
  it("cannot select a hidden model exposed only for visibility management", () => {
    const option = modelOption("gpt-next");
    expect(
      canSelectModel(option, [
        { providerKey: "codex", providerLabel: "Codex", models: [{ ...option, isHidden: true }] },
      ]),
    ).toBe(false);
  });

  it("cannot select a model after sign-out removes it from the catalog", () => {
    const option = modelOption("gemini-native");
    const group = { providerKey: "codex", providerLabel: "Codex", models: [option] };

    expect(canSelectModel(option, [group])).toBe(true);
    expect(canSelectModel(option, [])).toBe(false);
    expect(
      canSelectModel(option, [
        {
          ...group,
          models: [{ ...option, isUnavailable: true }],
        },
      ]),
    ).toBe(false);
  });
});
