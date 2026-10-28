import type { MenuAction } from "@react-native-menu/menu";
import { isProviderDriverKind, type ModelSelection, type RuntimeMode } from "@t3tools/contracts";
import {
  buildTraitsTriggerDisplay,
  getPromptControlledTraits,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";
import type { ModelOption } from "../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../lib/providerOptions";
import { AppText as Text } from "./ui/AppText";
import { Menu } from "./ui/Menu";
import { ComposerInlineControl } from "./ComposerToolbar";
import { ProviderIcon, ProviderInstanceIcon } from "./ProviderIcon";

/** The selected model's option descriptors and the Traits label desktop shows for them. */
export function resolveComposerTraits(input: {
  readonly modelOption: ModelOption | null;
  readonly selection: ModelSelection | null;
  readonly reportedSelection?: ModelSelection | null | undefined;
  readonly prompt: string;
}) {
  const descriptors = resolveProviderOptionDescriptors({
    capabilities: input.modelOption?.capabilities,
    selections: input.selection?.options,
  });
  const promptTraits = getPromptControlledTraits(descriptors, input.prompt);
  const provider = input.modelOption?.providerDriver;
  const label = isProviderDriverKind(provider)
    ? buildTraitsTriggerDisplay({
        provider,
        descriptors,
        primarySelectDescriptorId: promptTraits.primarySelectDescriptor?.id ?? null,
        ultrathinkPromptControlled: promptTraits.ultrathinkPromptControlled,
        modelSelection: input.selection,
        reportedModelSelection: input.reportedSelection,
      }).label
    : "";
  return { descriptors, promptTraits, label };
}

type ComposerTraits = ReturnType<typeof resolveComposerTraits>;

export function ComposerModelControl(props: {
  readonly modelOption: ModelOption | null;
  readonly selection: ModelSelection | null;
  readonly traitsLabel: string;
  readonly surfaceColor: string;
  readonly disabled?: boolean;
  readonly size?: "regular" | "large";
  readonly iconOnly?: boolean;
  /** Replaces the name and its muted traits suffix with one text. */
  readonly label?: string;
  readonly onPress: () => void;
}) {
  const badge = props.modelOption?.providerBadge;
  const label = props.modelOption?.label ?? props.selection?.model ?? "Choose model";
  return (
    <ComposerInlineControl
      accessibilityLabel={[
        "Model and reasoning settings",
        label,
        badge?.showBadge ? badge.displayName : null,
        props.traitsLabel,
      ]
        .filter(Boolean)
        .join(", ")}
      size={props.size}
      disabled={props.disabled}
      emphasized
      renderIcon={(size) =>
        badge?.showBadge ? (
          <ProviderInstanceIcon
            iconUrl={props.modelOption?.providerIconUrl}
            provider={props.modelOption?.providerDriver}
            displayName={badge.displayName}
            accentColor={badge.accentColor}
            showBadge
            surfaceColor={props.surfaceColor}
            size={size}
          />
        ) : (
          <ProviderIcon
            iconUrl={props.modelOption?.providerIconUrl}
            provider={props.modelOption?.providerDriver}
            size={size}
          />
        )
      }
      label={props.label ?? props.modelOption?.shortName ?? label}
      iconOnly={props.iconOnly}
      suffix={
        props.traitsLabel && props.label === undefined ? (
          <Text
            className={
              props.size === "large"
                ? "text-sm text-foreground-muted"
                : "text-xs text-foreground-muted"
            }
            numberOfLines={1}
          >
            {props.traitsLabel}
          </Text>
        ) : undefined
      }
      maxWidth="100%"
      onPress={props.onPress}
    />
  );
}

/** The Traits chip: a native menu with the sheet's option choices. */
export function ComposerTraitsMenuControl(props: {
  readonly size: "regular" | "large";
  readonly traits: ComposerTraits;
  readonly selection: ModelSelection;
  readonly reportedSelection?: ModelSelection | null | undefined;
  readonly onPick: (id: string, value: string | boolean) => void;
}) {
  const { descriptors, promptTraits } = props.traits;
  const picks = new Map<string, { readonly id: string; readonly value: string | boolean }>();
  const pickAction = (id: string, value: string | boolean, action: Omit<MenuAction, "id">) => {
    const eventId = JSON.stringify([id, value]);
    picks.set(eventId, { id, value });
    return { ...action, id: eventId };
  };
  const actions = descriptors.map((descriptor): MenuAction => {
    if (descriptor.type === "boolean") {
      return pickAction(descriptor.id, descriptor.currentValue !== true, {
        title: descriptor.label,
        state: descriptor.currentValue === true ? "on" : "off",
      });
    }
    const current =
      promptTraits.ultrathinkPromptControlled &&
      descriptor.id === promptTraits.primarySelectDescriptor?.id
        ? "ultrathink"
        : getProviderOptionCurrentValue(descriptor, props.selection, props.reportedSelection);
    return {
      id: descriptor.id,
      title: descriptor.label,
      displayInline: true,
      subactions: selectableProviderOptionChoices(descriptor).map((choice) =>
        pickAction(descriptor.id, choice.id, {
          title: choice.label,
          ...(choice.description ? { subtitle: choice.description } : {}),
          state: choice.id === current ? "on" : "off",
        }),
      ),
    };
  });
  return (
    <Menu
      accessible
      accessibilityLabel={`Model options, ${props.traits.label}`}
      accessibilityRole="button"
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        const pick = picks.get(nativeEvent.event);
        if (pick) props.onPick(pick.id, pick.value);
      }}
    >
      <ComposerInlineControl
        size={props.size}
        emphasized
        label={props.traits.label}
        maxWidth="100%"
      />
    </Menu>
  );
}

/** The Mode chip: a native menu with the sheet's runtime choices. */
export function ComposerRuntimeModeMenuControl(props: {
  readonly size: "regular" | "large";
  readonly runtimeMode: RuntimeMode;
  readonly choices: ReadonlyArray<{
    readonly mode: RuntimeMode;
    readonly label: string;
    readonly description: string;
  }>;
  readonly onSelect: (runtimeMode: RuntimeMode) => void;
}) {
  const label =
    props.choices.find((choice) => choice.mode === props.runtimeMode)?.label ?? props.runtimeMode;
  return (
    <Menu
      accessible
      accessibilityLabel={`Runtime, ${label}`}
      accessibilityRole="button"
      actions={props.choices.map((choice) => ({
        id: choice.mode,
        title: choice.label,
        subtitle: choice.description,
        state: choice.mode === props.runtimeMode ? ("on" as const) : ("off" as const),
      }))}
      onPressAction={({ nativeEvent }) => {
        const choice = props.choices.find((candidate) => candidate.mode === nativeEvent.event);
        if (choice) props.onSelect(choice.mode);
      }}
    >
      <ComposerInlineControl size={props.size} emphasized label={label} maxWidth="100%" />
    </Menu>
  );
}
