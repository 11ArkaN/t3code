import { useWorkspaceSidebarHeaderItem } from "../layout/useWorkspaceSidebarHeaderItem";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { VcsStatusResult } from "@t3tools/contracts";
import { threadHeaderAppearance } from "./thread-header-appearance";
import { isDuoDevice } from "../../lib/device-type";
import type { AppNativeStackNavigationOptions } from "../../native/StackHeader";
import { useDeviceType } from "../../native/native-layout-metrics";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadTitleMenu } from "./useThreadTitleMenu";

type NativeHeaderItems = ReadonlyArray<Record<string, unknown>>;

type ThreadHeaderGitControls = {
  readonly gitStatus: VcsStatusResult | null;
  readonly canOpenTerminal: boolean;
  readonly onOpenTerminal: (terminalId?: string | null) => void;
  readonly onMergeBack?: () => void;
};

export function useThreadHeaderOptions(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly headerColor: string;
  readonly usesNativeHeaderGlass: boolean;
  readonly gitControls: ThreadHeaderGitControls;
  /** Drafts have no title menu. */
  readonly titleMenu?: {
    readonly thread: EnvironmentThreadShell;
    readonly canMutate: boolean;
    readonly path: string | null;
  };
  readonly fileInspectorSupported: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  /** Absent when the panel would be empty. */
  readonly onTogglePanel: (() => void) | undefined;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
}) {
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const deviceType = useDeviceType();
  const usesDuoHeader = usesNativeWorkspaceColumns && isDuoDevice(deviceType);
  const navigation = useNavigation();
  const { layout, startNewTask } = useAdaptiveWorkspaceLayout();
  const sidebarHeaderItem = useWorkspaceSidebarHeaderItem();
  const titleMenu = useThreadTitleMenu({
    thread: props.titleMenu?.thread ?? null,
    canMutate: props.titleMenu?.canMutate ?? false,
    path: props.titleMenu?.path ?? null,
    gitStatus: props.gitControls.gitStatus,
    onMergeBack: props.gitControls.onMergeBack,
  });
  const splitLeftHeaderItems: NativeHeaderItems = [
    ...(!usesDuoHeader
      ? [
          {
            spacing: 18,
            type: "spacing" as const,
          },
        ]
      : []),
    ...(props.onReturnToThread
      ? [
          withNativeGlassHeaderItem({
            accessibilityLabel: "Return to chat",
            icon: { name: "chevron.left", type: "sfSymbol" as const },
            identifier: "thread-left-return",
            onPress: props.onReturnToThread,
            type: "button" as const,
          }),
        ]
      : []),
    sidebarHeaderItem,
    ...(!usesDuoHeader && !props.draft
      ? [
          withNativeGlassHeaderItem({
            accessibilityLabel: "New thread",
            icon: { name: "square.and.pencil", type: "sfSymbol" as const },
            identifier: "thread-left-new-task",
            label: "New thread",
            onPress: startNewTask,
            type: "button" as const,
          }),
        ]
      : []),
  ];
  const canGoBack = navigation.canGoBack();
  const compactHomeHeaderItems: NativeHeaderItems = [
    withNativeGlassHeaderItem({
      accessibilityLabel: "Go to threads list",
      icon: { name: "list.bullet", type: "sfSymbol" as const },
      identifier: "thread-left-home",
      onPress: () => navigation.dispatch(StackActions.replace("Home")),
      type: "button" as const,
    }),
  ];
  // Desktop's right panel toggle: the panel holds browser, terminal, files, diff and devices.
  const panelHeaderItems: NativeHeaderItems = [
    {
      accessibilityLabel: "Toggle panel",
      disabled: props.onTogglePanel === undefined,
      icon: { name: "sidebar.right", type: "sfSymbol" },
      identifier: "thread-right-panel",
      label: "Panel",
      onPress: props.onTogglePanel,
      sharesBackground: true,
      type: "button",
      variant: "plain",
    },
  ];

  const options: AppNativeStackNavigationOptions = {
    ...threadHeaderAppearance(props.usesNativeHeaderGlass),
    headerTitle: props.title,
    title: props.title,
    headerBackVisible: !layout.usesSplitView,
    unstable_headerLeftItems: layout.usesSplitView
      ? () => splitLeftHeaderItems
      : canGoBack
        ? undefined
        : () => compactHomeHeaderItems,
    // The workspace navigator adds compose to the Duo detail column's bar.
    unstable_headerRightItems: () => panelHeaderItems,
    unstable_headerToolbarItems: () => [],
    unstable_headerSubtitle: props.usesNativeHeaderGlass ? props.subtitle : undefined,
    unstable_headerTitleMenu: titleMenu.menu,
    contentStyle: undefined,
  };
  return {
    options,
    // Factories re-read only on version changes; include displayed items and the state the
    // panel button's handler reads.
    optionsVersion: [
      splitLeftHeaderItems,
      panelHeaderItems,
      usesDuoHeader,
      props.fileInspectorSupported,
      props.inspectorMode,
    ],
    sidebar: false,
    overlay: titleMenu.overlay,
  };
}
