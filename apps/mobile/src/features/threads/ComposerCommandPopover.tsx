import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type {
  EnvironmentId,
  EnvironmentMachineKind,
  PullRequestContextMetadata,
  ScopedThreadRef,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import type { ComposerTriggerKind } from "@t3tools/shared/composerTrigger";
import { memo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ENVIRONMENT_MACHINE_SYMBOLS } from "../../components/EnvironmentMachineSymbol";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { PierreEntryIcon } from "../../components/PierreEntryIcon";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";
export type ComposerCommandItem =
  | {
      readonly id: string;
      readonly type: "pull-request";
      readonly pullRequest: PullRequestContextMetadata;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "path";
      readonly path: string;
      readonly kind: "file" | "directory";
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "thread";
      readonly thread: ScopedThreadRef;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "environment";
      readonly environmentId: EnvironmentId;
      readonly machine: EnvironmentMachineKind;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "slash-command";
      readonly command: string;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "provider-slash-command";
      readonly command: ServerProviderSlashCommand;
      readonly label: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly type: "skill";
      readonly skill: ServerProviderSkill;
      readonly label: string;
      readonly description: string;
    };

interface ComposerCommandPopoverProps {
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly triggerKind: ComposerTriggerKind | null;
  readonly isLoading: boolean;
  readonly error?: string | null;
  readonly onSelect: (item: ComposerCommandItem) => void;
}

/** Whole rows only: a half row under the edge reads as clipped, not as more to scroll. */
const MAX_VISIBLE_ROWS = 4;
const ESTIMATED_ROW_HEIGHT = 42;

function PopoverSurface(props: { readonly children: React.ReactNode }) {
  // iOS opens this over the moving transcript; a see-through surface makes both unreadable.
  // The fade lets messages above dissolve into the screen instead of being cut by the edge.
  if (Platform.OS === "ios") {
    return (
      <View>
        <View
          pointerEvents="none"
          className="absolute bottom-full h-6 bg-linear-to-b from-screen/0 to-screen"
          style={{ left: -12, right: -12 }}
        />
        <View className="overflow-hidden rounded-xl border border-border bg-card">
          {props.children}
        </View>
      </View>
    );
  }

  return (
    <GlassSurface
      glassEffectStyle="clear"
      tintColorClassName="accent-glass-surface"
      style={{ borderRadius: 16, overflow: "hidden" }}
    >
      {props.children}
    </GlassSurface>
  );
}

const SKILL_SOURCE_SYMBOL_BY_KIND: Record<ProviderSkillSourceKind, AppSymbolName> = {
  app: "square.grid.2x2",
  repo: "folder",
  project: "folder",
  personal: "person.crop.circle",
  system: "gearshape",
  other: "cube",
};

function itemIcon(item: ComposerCommandItem): AppSymbolName | null {
  switch (item.type) {
    case "pull-request":
      return pullRequestStatus(item.pullRequest).icon;
    case "slash-command":
    case "provider-slash-command":
      return "terminal";
    case "skill":
      return SKILL_SOURCE_SYMBOL_BY_KIND[resolveProviderSkillSourceKind(item.skill)];
    case "path":
      return null;
    case "thread":
      return "text.bubble";
    case "environment":
      return ENVIRONMENT_MACHINE_SYMBOLS[item.machine];
  }
}

function groupLabel(triggerKind: ComposerTriggerKind | null): string | null {
  switch (triggerKind) {
    case "pull-request":
      return "Pull requests";
    case "slash-command":
      return "Commands";
    case "skill":
      return "Skills";
    case "path":
      return "Files";
    default:
      return null;
  }
}

function emptyText(triggerKind: ComposerTriggerKind | null, isLoading: boolean): string {
  if (isLoading) {
    return triggerKind === "path" ? "Searching files…" : "Loading…";
  }
  switch (triggerKind) {
    case "pull-request":
      return "No matching pull requests.";
    case "path":
      return "No matching files or folders.";
    case "skill":
      return "No skills found.";
    case "slash-command":
      return "No matching commands.";
    default:
      return "No results.";
  }
}

const CommandRow = memo(function CommandRow(props: {
  readonly item: ComposerCommandItem;
  readonly onPress: () => void;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly isLast: boolean;
  readonly isSlashSkill: boolean;
}) {
  const iconName = itemIcon(props.item);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      onLayout={props.onLayout}
      className="flex-row items-center gap-2.5 border-border px-3.5 py-2.5 active:opacity-60"
      style={{ borderBottomWidth: props.isLast ? 0 : StyleSheet.hairlineWidth }}
    >
      {props.item.type === "path" ? (
        <PierreEntryIcon path={props.item.path} kind={props.item.kind} size={16} />
      ) : iconName ? (
        <SymbolView
          name={iconName}
          size={14}
          tintColorClassName={
            props.item.type === "pull-request"
              ? pullRequestStatus(props.item.pullRequest).tint
              : "accent-icon-subtle"
          }
          type="monochrome"
        />
      ) : null}
      <Text className="shrink-0 text-base font-t3-medium text-foreground" numberOfLines={1}>
        {props.isSlashSkill && props.item.type === "skill" ? (
          <>
            <Text className="text-foreground-muted">skill:</Text>
            {props.item.skill.name}
          </>
        ) : (
          props.item.label
        )}
      </Text>
      {props.item.description ? (
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
          {props.item.description}
        </Text>
      ) : null}
    </Pressable>
  );
});

export const ComposerCommandPopover = memo(function ComposerCommandPopover(
  props: ComposerCommandPopoverProps,
) {
  const label = groupLabel(props.triggerKind);
  // Rows grow with Dynamic Type, so the cap comes from a measured row, not a fixed height.
  const [rowHeight, setRowHeight] = useState(0);

  return (
    <PopoverSurface>
      {label ? (
        <View className="px-3.5 pt-2.5 pb-1">
          <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
            {label}
          </Text>
        </View>
      ) : null}
      {props.items.length > 0 ? (
        <ScrollView
          style={{ maxHeight: (rowHeight || ESTIMATED_ROW_HEIGHT) * MAX_VISIBLE_ROWS }}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          {props.items.map((item, index) => (
            <CommandRow
              key={item.id}
              item={item}
              onPress={() => props.onSelect(item)}
              onLayout={
                index === 0 ? (event) => setRowHeight(event.nativeEvent.layout.height) : undefined
              }
              isLast={index === props.items.length - 1}
              isSlashSkill={props.triggerKind === "slash-command" && item.type === "skill"}
            />
          ))}
        </ScrollView>
      ) : (
        <View className="px-3.5 py-2.5">
          <Text className="text-xs text-foreground-tertiary">
            {props.error ?? emptyText(props.triggerKind, props.isLoading)}
          </Text>
        </View>
      )}
    </PopoverSurface>
  );
});
