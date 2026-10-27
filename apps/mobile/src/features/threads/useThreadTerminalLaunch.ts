import { StackActions, useNavigation } from "@react-navigation/native";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  DEFAULT_SERVER_SETTINGS,
  type ProjectScript,
} from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptTerminalInput,
  resolveProjectScripts,
} from "@t3tools/shared/projectScripts";

import { uuidv4 } from "../../lib/uuid";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useKnownTerminalSessions } from "../../state/use-terminal-session";
import { stagePendingTerminalLaunch } from "../terminal/terminalLaunchContext";
import {
  buildTerminalMenuSessions,
  nextOpenTerminalId,
  resolveProjectScriptTerminalId,
} from "../terminal/terminalMenu";

/** A thread's terminals and project scripts, and the ways to open them. */
export function useThreadTerminalLaunch(input: {
  readonly thread: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly serverSettings: Parameters<typeof resolveProjectScripts>[0] | undefined;
  readonly worktreePath: string | null;
  /** A sheet passes this so the terminal takes its place instead of opening underneath it. */
  readonly replace?: boolean;
}) {
  const navigation = useNavigation();
  const { thread, project, worktreePath } = input;
  const environmentId = thread?.environmentId ?? null;
  const canRead = useEnvironmentScope(environmentId, AuthTerminalReadScope);
  const canOperate = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const { sessions: knownSessions } = useKnownTerminalSessions({
    environmentId,
    threadId: thread?.id ?? null,
  });
  const sessions = buildTerminalMenuSessions({
    knownSessions: knownSessions ?? [],
    workspaceRoot: project?.workspaceRoot ?? null,
  });
  const projectScripts = project
    ? resolveProjectScripts(input.serverSettings ?? DEFAULT_SERVER_SETTINGS, project)
    : [];
  const showTerminal = (params: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly terminalId?: string;
  }) => {
    if (input.replace) navigation.dispatch(StackActions.replace("ThreadTerminal", params));
    else void navigation.navigate("ThreadTerminal", params);
  };

  const open = (terminalId?: string | null) => {
    if (
      !thread ||
      !project?.workspaceRoot ||
      (!readEnvironmentScope(thread.environmentId, AuthTerminalReadScope) &&
        !readEnvironmentScope(thread.environmentId, AuthTerminalOperateScope))
    ) {
      return;
    }

    showTerminal({
      environmentId: String(thread.environmentId),
      threadId: String(thread.id),
      ...(terminalId ? { terminalId } : {}),
    });
  };

  const openNew = () => {
    if (
      !thread ||
      !project?.workspaceRoot ||
      !readEnvironmentScope(thread.environmentId, AuthTerminalOperateScope)
    ) {
      return;
    }

    const nextId = nextOpenTerminalId({
      listedTerminalIds: sessions.map((session) => session.terminalId),
      ...(knownSessions === null ||
      !readEnvironmentScope(thread.environmentId, AuthTerminalReadScope)
        ? { uniqueSuffix: uuidv4() }
        : {}),
    });
    showTerminal({
      environmentId: String(thread.environmentId),
      threadId: String(thread.id),
      terminalId: nextId,
    });
  };

  const runProjectScript = async (script: ProjectScript) => {
    if (
      !thread ||
      !project?.workspaceRoot ||
      !readEnvironmentScope(thread.environmentId, AuthTerminalOperateScope)
    ) {
      return;
    }

    const targetTerminalId = resolveProjectScriptTerminalId({
      existingTerminalIds: sessions.map((session) => session.terminalId),
      ...(knownSessions === null ||
      !readEnvironmentScope(thread.environmentId, AuthTerminalReadScope)
        ? { uniqueSuffix: uuidv4() }
        : {}),
      hasRunningTerminal: sessions.some(
        (session) => session.status === "running" || session.status === "starting",
      ),
    });
    const cwd = projectScriptCwd({
      project: { cwd: project.workspaceRoot },
      worktreePath,
    });
    const env = projectScriptRuntimeEnv({
      project: { cwd: project.workspaceRoot },
      worktreePath,
    });
    stagePendingTerminalLaunch({
      target: {
        environmentId: thread.environmentId,
        threadId: thread.id,
        terminalId: targetTerminalId,
      },
      launch: {
        cwd,
        worktreePath,
        env,
        initialInput: projectScriptTerminalInput(script.command),
      },
    });

    showTerminal({
      environmentId: String(thread.environmentId),
      threadId: String(thread.id),
      terminalId: targetTerminalId,
    });
  };

  return {
    canOpen: Boolean(project?.workspaceRoot) && (canRead || canOperate),
    canOperate,
    sessions,
    projectScripts,
    open,
    openNew,
    runProjectScript,
  };
}
