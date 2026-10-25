import {
  INITIAL_TERMINAL_LIFECYCLE,
  transitionTerminalLifecycle,
  type TerminalLifecycleEvent,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import { useEffect, useEffectEvent, useRef } from "react";

export function useTerminalLifecycle({
  terminalKey,
  canOperate,
  observing,
  attached,
  terminal,
  reopen,
  onRunning,
  onExit,
}: {
  readonly terminalKey: string;
  readonly canOperate: boolean;
  readonly observing: boolean;
  readonly attached: boolean;
  readonly terminal: Pick<TerminalSessionState, "status" | "version">;
  readonly reopen: () => Promise<boolean>;
  readonly onRunning: () => void;
  readonly onExit: () => void;
}) {
  const lifecycle = useRef({ key: terminalKey, state: INITIAL_TERMINAL_LIFECYCLE });
  const reopenTerminal = useEffectEvent(reopen);
  const handleRunning = useEffectEvent(onRunning);
  const handleExit = useEffectEvent(onExit);

  useEffect(() => {
    if (lifecycle.current.key !== terminalKey) {
      lifecycle.current = { key: terminalKey, state: INITIAL_TERMINAL_LIFECYCLE };
    }
    const current = lifecycle.current;
    const apply = (event: TerminalLifecycleEvent) => {
      const step = transitionTerminalLifecycle(current.state, event);
      current.state = step.state;
      return step.command;
    };
    if (!canOperate) {
      if (observing || terminal.version > 0) apply({ type: "observed" });
      apply({ type: "detached", canOperate: false });
      return;
    }
    if (!attached) {
      apply({ type: "detached", canOperate: true });
      return;
    }

    const command = apply({ type: "status", status: terminal.status, version: terminal.version });
    if (terminal.version > 0 && (terminal.status === "running" || terminal.status === "starting")) {
      handleRunning();
    }
    if (command === "exit") {
      handleExit();
      return;
    }
    if (command !== "reopen") return;
    void reopenTerminal().then((succeeded) => {
      if (!succeeded && lifecycle.current === current) apply({ type: "reopen-failed" });
    });
  }, [attached, canOperate, observing, terminal.status, terminal.version, terminalKey]);
}
