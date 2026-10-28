import type { SubagentPillSegment } from "@t3tools/client-runtime/state/thread-subagents";
import { Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { WorkingTimer } from "./floating-working-control";
import type { FloatingWorkingStatus, RunStatusSegment } from "./floating-working-status";

const ROW_HEIGHT = 36;
/** The row plus the gap to the card or composer below it. */
export const COMPOSER_STATUS_ROW_HEIGHT = ROW_HEIGHT + 4;

type PreviewSegment = { readonly count: number; readonly onPress: () => void } | null;

/**
 * Run status docked to the top of the iOS composer block. It takes layout space, so the feed's
 * measured inset keeps messages clear of it; `height` eases that space in and out.
 */
export function ComposerStatusRow(props: {
  readonly segments: ReadonlyArray<RunStatusSegment>;
  readonly height: SharedValue<number>;
  readonly lift: SharedValue<number>;
  readonly contentMaxWidth: number | undefined;
  readonly status: FloatingWorkingStatus | null;
  readonly agents: SubagentPillSegment | null;
  readonly onOpenAgents: () => void;
  readonly queuedCount: number;
  readonly onOpenQueue: () => void;
  readonly devicePreview: PreviewSegment;
  readonly browserPreview: PreviewSegment;
  readonly showScrollToEnd: boolean;
  readonly onScrollToEnd: () => void;
}) {
  const { height, lift } = props;
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));
  const heightStyle = useAnimatedStyle(() => ({ height: height.value }));
  const trailing = props.segments.filter(
    (segment) => segment !== "status" && segment !== "scroll-to-end",
  );
  const scrollToEnd = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Scroll to end"
      onPressIn={props.onScrollToEnd}
      className="size-9 items-center justify-center active:opacity-70"
    >
      <SymbolView name="chevron.down" size={14} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );

  const trailingSegment = (segment: (typeof trailing)[number]): ReactNode => {
    switch (segment) {
      case "agents":
        return props.agents === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open agents, ${props.agents.accessibilityLabel}`}
            accessibilityHint="Opens this turn's subagents"
            onPress={props.onOpenAgents}
            className="h-9 flex-row items-center gap-1.5 px-2.5 active:opacity-70"
          >
            <SymbolView name="person.2" size={13} tintColorClassName="accent-foreground-muted" />
            <Text className="font-t3-medium text-xs tabular-nums" numberOfLines={1}>
              {props.agents.label}
            </Text>
          </Pressable>
        );
      case "queue":
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open queue, ${props.queuedCount} messages`}
            accessibilityHint="Opens queued messages to send now, edit, or remove"
            onPress={props.onOpenQueue}
            className="h-9 flex-row items-center gap-1.5 px-2.5 active:opacity-70"
          >
            <SymbolView name="list.number" size={13} tintColorClassName="accent-foreground-muted" />
            <Text className="font-t3-medium text-xs tabular-nums" numberOfLines={1}>
              {props.queuedCount} queued
            </Text>
          </Pressable>
        );
      case "previews":
        return (
          <View className="flex-row items-center">
            {props.devicePreview !== null ? (
              <PreviewButton
                icon={{ ios: "iphone", android: "smartphone" }}
                count={props.devicePreview.count}
                accessibilityLabel={
                  props.devicePreview.count === 1
                    ? "View device"
                    : `View ${props.devicePreview.count} devices`
                }
                onPress={props.devicePreview.onPress}
              />
            ) : null}
            {props.browserPreview !== null ? (
              <PreviewButton
                icon="globe"
                count={props.browserPreview.count}
                accessibilityLabel={
                  props.browserPreview.count === 1
                    ? "View browser"
                    : `View ${props.browserPreview.count} browser tabs`
                }
                onPress={props.browserPreview.onPress}
              />
            ) : null}
          </View>
        );
    }
  };

  return (
    <Animated.View pointerEvents="box-none" className="px-3" style={liftStyle}>
      <View
        pointerEvents="box-none"
        className="w-full self-center"
        style={{ maxWidth: props.contentMaxWidth }}
      >
        {props.segments.length === 0 && props.showScrollToEnd ? (
          <View className="absolute bottom-full right-0 mb-1">
            <RowSurface className="w-9">{scrollToEnd}</RowSurface>
          </View>
        ) : null}
        <Animated.View
          pointerEvents="box-none"
          className="justify-end overflow-hidden"
          style={heightStyle}
        >
          {props.segments.length > 0 ? (
            <View className="pb-1">
              <RowSurface className="flex-row items-center">
                {props.status !== null ? (
                  <StatusSegment status={props.status} />
                ) : (
                  <View className="flex-1" />
                )}
                {trailing.map((segment, index) => (
                  <Fragment key={segment}>
                    {index > 0 || props.status !== null ? (
                      <View className="h-4 w-px bg-border" />
                    ) : null}
                    {trailingSegment(segment)}
                  </Fragment>
                ))}
                {props.segments.includes("scroll-to-end") ? scrollToEnd : null}
              </RowSurface>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** The composer's own material, so the row reads as part of the composer block. */
function RowSurface(props: { readonly className: string; readonly children: ReactNode }) {
  return (
    <GlassSurface
      chrome="none"
      fallbackClassName="border border-composer-border"
      glassEffectStyle="regular"
      tintColor="transparent"
      className={props.className}
      style={{ height: ROW_HEIGHT, borderRadius: ROW_HEIGHT / 2 }}
    >
      {props.children}
    </GlassSurface>
  );
}

function StatusSegment(props: { readonly status: FloatingWorkingStatus }) {
  const { status } = props;
  const onPress =
    status.kind === "connection" || status.kind === "child-input" || status.kind === "background"
      ? status.onPress
      : null;
  const action = status.kind === "background" || status.kind === "lifecycle" ? status.action : null;
  const icon = statusIcon(status);
  const content = (
    <>
      {status.kind === "connection" && status.tone === "unavailable" ? (
        <View className="size-2 rounded-full bg-danger" />
      ) : icon !== null ? (
        <SymbolView
          name={icon}
          size={13}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      ) : null}
      {status.kind === "working" ? (
        <WorkingTimer startedAt={status.startedAt} />
      ) : (
        <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
          {status.kind === "compacting" ? "Compacting…" : status.label}
        </Text>
      )}
    </>
  );
  const labelClassName = "h-9 min-w-0 shrink flex-row items-center gap-1.5 pl-3 pr-2.5";
  return (
    <View className="min-w-0 flex-1 flex-row items-center">
      {onPress !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={statusAccessibilityLabel(status)}
          onPress={onPress}
          className={`${labelClassName} active:opacity-70`}
        >
          {content}
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityLabel={statusAccessibilityLabel(status)}
          className={labelClassName}
        >
          {content}
        </View>
      )}
      {action !== null ? (
        <>
          <View className="h-4 w-px bg-border" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
            accessibilityState={{ disabled: action.disabled }}
            disabled={action.disabled}
            onPress={action.onPress}
            className={`h-9 shrink-0 justify-center px-2.5 active:opacity-70 ${action.disabled ? "opacity-50" : ""}`}
          >
            <Text className="font-t3-medium text-xs text-foreground" numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function PreviewButton(props: {
  readonly icon: AppSymbolName;
  readonly count: number;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      className="h-9 flex-row items-center gap-1 px-2.5 active:opacity-70"
    >
      <SymbolView name={props.icon} size={15} tintColorClassName="accent-foreground-muted" />
      {props.count > 1 ? (
        <Text className="font-t3-medium text-xs tabular-nums">{props.count}</Text>
      ) : null}
    </Pressable>
  );
}

// Static icons only: a spinner here would repaint every frame for the whole run.
function statusIcon(status: FloatingWorkingStatus): AppSymbolName | null {
  switch (status.kind) {
    case "working":
      return null;
    case "syncing":
    case "connection":
      return "arrow.clockwise";
    case "compacting":
      return "arrow.down.right.and.arrow.up.left";
    case "child-input":
      return "text.bubble";
    case "background":
      return status.waiting ? "person.2" : "terminal";
    case "lifecycle":
      return status.state === "settled" ? "checkmark.circle" : "clock";
    case "goal":
      return "target";
    case "preparing":
      return "arrow.triangle.branch";
  }
}

function statusAccessibilityLabel(status: FloatingWorkingStatus): string | undefined {
  switch (status.kind) {
    case "working":
      return undefined;
    case "compacting":
      return "Compacting";
    case "child-input":
    case "background":
    case "goal":
      return status.accessibilityLabel;
    default:
      return status.label;
  }
}
