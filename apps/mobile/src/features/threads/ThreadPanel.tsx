import { useAtomValue } from "@effect/atom-react";
import {
  CommonActions,
  StackActions,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { projectScriptMenuLabel } from "@t3tools/shared/projectScripts";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { deviceEnvironment } from "../../state/device";
import { useThreadServerBrowserTabs } from "../../state/preview";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useThreadSelection } from "../../state/use-thread-selection";
import { vcsEnvironment } from "../../state/vcs";
import { threadDevicePreviews } from "../devices/threadDevicePreviews";
import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";
import { basename, getTerminalStatusLabel, projectScriptMenuIcon } from "../terminal/terminalMenu";
import {
  THREAD_PANEL_TAB_LABELS,
  lastThreadPanelTabs,
  resolveThreadPanelTab,
  resolveThreadPullRequest,
  threadPanelShowsTab,
  threadPanelTabs,
  type ThreadPanelPresentation,
  type ThreadPanelTab,
} from "./thread-panel";
import { useOpenThreadPullRequests } from "./use-open-thread-pull-requests";
import { useThreadTerminalLaunch } from "./useThreadTerminalLaunch";

type ThreadTerminalLaunch = ReturnType<typeof useThreadTerminalLaunch>;

/**
 * Desktop's right panel on iOS: a tab strip over the tab's content. A sheet replaces itself with
 * the tabs that open their own screen; the inspector column opens them beside it.
 */
export function ThreadPanel(props: {
  readonly thread: EnvironmentThreadShell;
  readonly cwd: string | null;
  readonly presentation: ThreadPanelPresentation;
  readonly terminal: ThreadTerminalLaunch;
  readonly tab: ThreadPanelTab | null;
  readonly onSelectTab: (tab: ThreadPanelTab) => void;
  readonly children: (tab: ThreadPanelTab | null) => ReactNode;
}) {
  const { thread, cwd, presentation } = props;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const columnSafeArea = useNativeColumnLayoutMetrics()?.safeArea ?? insets;
  const supportsLinks = useAtomValue(
    serverEnvironment.configValueAtom(thread.environmentId),
    (config) => config?.environment.capabilities.threadPullRequests === true,
  );
  const supportsBrowser = useAtomValue(
    serverEnvironment.configValueAtom(thread.environmentId),
    (config) => config?.environment.capabilities.serverBrowser === true,
  );
  const gitStatus = useEnvironmentQuery(
    cwd === null
      ? null
      : vcsEnvironment.status({ environmentId: thread.environmentId, input: { cwd } }),
  );
  const deviceState = useEnvironmentQuery(
    deviceEnvironment.state({ environmentId: thread.environmentId, input: {} }),
  );
  const browserTabs = useThreadServerBrowserTabs({
    environmentId: thread.environmentId,
    threadId: thread.id,
    enabled: supportsBrowser,
  });
  const openThreadPullRequests = useOpenThreadPullRequests({
    replace: presentation === "sheet",
  });
  // UIKit keeps a tapped segment selected, so the strip remounts after a tab opens its own screen.
  const [stripRevision, setStripRevision] = useState(0);
  const pullRequest = resolveThreadPullRequest({
    thread,
    supportsLinks,
    gitStatus: gitStatus.data,
  });
  const tabs = threadPanelTabs({
    browser: browserTabs.tabs.length > 0,
    terminal: props.terminal.canOpen,
    files: cwd !== null,
    diff: cwd !== null && (gitStatus.data?.isRepo ?? true),
    "pull-request": pullRequest !== null,
    device: threadDevicePreviews(deviceState.data, thread.id).length > 0,
  });
  const threadKey = scopedThreadKey(thread.environmentId, thread.id);
  const tab = resolveThreadPanelTab({
    tabs,
    presentation,
    requested: props.tab,
    remembered: lastThreadPanelTabs.get(threadKey),
  });

  const openScreen = (screen: ThreadPanelTab) => {
    setStripRevision((revision) => revision + 1);
    if (screen === "pull-request") {
      if (pullRequest) openThreadPullRequests(thread, pullRequest);
      return;
    }
    const name =
      screen === "browser"
        ? "ThreadBrowserPreview"
        : screen === "device"
          ? "ThreadDevicePreview"
          : "ThreadReview";
    const params = { environmentId: thread.environmentId, threadId: thread.id };
    navigation.dispatch(
      presentation === "sheet"
        ? StackActions.replace(name, params)
        : CommonActions.navigate(name, params),
    );
  };
  const select = (next: ThreadPanelTab | "") => {
    if (next === "") return;
    if (!threadPanelShowsTab(next, presentation)) {
      openScreen(next);
      return;
    }
    lastThreadPanelTabs.set(threadKey, next);
    props.onSelectTab(next);
  };

  return (
    <View className="flex-1 bg-sheet">
      {tabs.length > 0 ? (
        <View
          className="px-3 pb-2"
          style={{ paddingTop: presentation === "sheet" ? 20 : columnSafeArea.top + 8 }}
        >
          <SegmentedControl<ThreadPanelTab | "">
            key={stripRevision}
            options={tabs.map((value) => ({ value, label: THREAD_PANEL_TAB_LABELS[value] }))}
            selected={tab ?? ""}
            onSelect={select}
            role="tab"
            size="compact"
          />
        </View>
      ) : null}
      <View className="flex-1">{props.children(tab)}</View>
    </View>
  );
}

/** The panel on iPhone and the folded Duo, where the window has no room for a column. */
export function ThreadPanelSheet(
  _props: StaticScreenProps<{ readonly environmentId: string; readonly threadId: string }>,
) {
  const navigation = useNavigation();
  const { selectedThread, selectedThreadProject, selectedEnvironmentRuntime } =
    useThreadSelection();
  const { selectedThreadCwd, selectedThreadWorktreePath } = useSelectedThreadWorktree();
  const terminal = useThreadTerminalLaunch({
    thread: selectedThread,
    project: selectedThreadProject,
    serverSettings: selectedEnvironmentRuntime?.serverConfig?.settings,
    worktreePath: selectedThreadWorktreePath,
    replace: true,
  });
  const [tab, setTab] = useState<ThreadPanelTab | null>(null);
  if (selectedThread === null) return null;
  return (
    <ThreadPanel
      thread={selectedThread}
      cwd={selectedThreadCwd}
      presentation="sheet"
      terminal={terminal}
      tab={tab}
      onSelectTab={setTab}
    >
      {(current) =>
        current === "terminal" ? (
          <ThreadPanelTerminal {...terminal} />
        ) : current === "files" && selectedThreadCwd !== null ? (
          <ThreadFileNavigatorPane
            cwd={selectedThreadCwd}
            environmentId={selectedThread.environmentId}
            headerInset={0}
            projectName={selectedThreadProject?.title ?? "Files"}
            selectedPath={null}
            onClose={() => navigation.goBack()}
            onSelectFile={(path) =>
              navigation.dispatch(
                StackActions.replace("ThreadFile", {
                  environmentId: String(selectedThread.environmentId),
                  threadId: String(selectedThread.id),
                  path: path.split("/").filter((segment) => segment.length > 0),
                }),
              )
            }
          />
        ) : null
      }
    </ThreadPanel>
  );
}

/** The Terminal tab: the thread's project scripts and shells, each opening the terminal screen. */
export function ThreadPanelTerminal(props: ThreadTerminalLaunch) {
  return (
    <ScrollView
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 14 }}
    >
      {props.projectScripts.length > 0 ? (
        <ListSection title="Scripts">
          {props.projectScripts.map((script) => (
            <ListRow
              key={script.id}
              // The panel is iOS-only; Android needs a value for the type.
              icon={{ ios: projectScriptMenuIcon(script.icon), android: "terminal" }}
              label={projectScriptMenuLabel(script)}
              description={script.command}
              disabled={!props.canOperate}
              onPress={() => void props.runProjectScript(script)}
            />
          ))}
        </ListSection>
      ) : null}
      <ListSection title="Terminals">
        {props.sessions.map((session) => (
          <ListRow
            key={session.terminalId}
            icon="terminal"
            label={session.displayLabel}
            description={[
              getTerminalStatusLabel({
                status: session.status,
                hasRunningSubprocess: session.hasRunningSubprocess,
              }),
              basename(session.cwd),
            ]
              .filter(Boolean)
              .join(" · ")}
            disabled={!props.canOpen}
            onPress={() => props.open(session.terminalId)}
          />
        ))}
        <ListRow
          icon="plus"
          label="Open new terminal"
          description="Start another shell for this thread"
          disabled={!props.canOperate}
          onPress={props.openNew}
        />
      </ListSection>
    </ScrollView>
  );
}
