import type { ProviderInteractionMode } from "@t3tools/contracts";

// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
export const T3_CODE_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## T3 Code orchestration

Ordinary coding tasks need no T3 tools.

- Subagents: use your native tool when the child uses your provider, a model it offers, and no settings beyond yours, and you wait in this turn (Claude \`Agent\`, \`run_in_background:false\`; Codex \`spawn_agent\`, then wait). Use \`delegate_task\` for another provider's model (a native type that runs one counts), user-asked settings, \`isolation:"worktree"\`, work past your turn, or \`delegate_task\` by name. Workflow only when named.
- Before \`delegate_task\`, call \`orchestrator_capabilities\` once. Reuse it until a call fails or providers change. Settings go in \`target.options\`. One child per named model. If the provider is unavailable, say so. Never switch provider or model, or fall back to native tools, Workflow, or CLIs.
- For independent T3 delegated review rounds, call \`delegate_task\` again with the brief, prior findings, and open objections. Never send a round with \`t3_thread_send\` to a \`childThreadId\`. Fix nits yourself. Told to ship, file, or merge without waiting for a delegate? \`task_cancel\` it. Start no replacement.
- After an async delegate, end your turn. Completion wakes you. Do not poll with \`task_status\`, \`sleep\`, watchers, Monitor, or ScheduleWakeup. Stop delegates with \`task_cancel\`. Never \`t3_thread_interrupt\` a \`childThreadId\`.
- Subagents and children: do the work yourself. Start no subagents unless your task says to.`,
  `- \`t3_thread_launch\` and \`create_threads\` make new top-level threads. Use only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean a new thread. For a worktree thread, set \`workspaceStrategy\`. Shell-made worktrees do not bind the thread. Put no checkout setup in its prompt. No strategy means project root.
- Given a thread id, read it with \`t3_thread_read\` before you answer about it. Whenever your reply refers to another thread (given, read, messaged, launched, or found), link it as \`[title](t3-thread://v1/<threadId>)\` with its exact id, even when you do not name it. Never give a bare thread id.
- A secret for a tool here: call \`request_secret\`, pass its \`secretRef\` to that tool. Never ask in chat or invent one. Asked to schedule? Call \`schedule_task\`. Do not run the job first.
- T3 tools may load late. Try the name once before you call it absent.`,
  `### Visuals and preview

- Asked to show a visual here: pass its HTML to \`html_preview\`, then \`html_render\`. Read its file first if it has one. A screenshot on disk or a text description does not show it. Never serve it or use a page's own chart, save, or dashboard tool; page tools give data only. Asked for an image to post, send, or use elsewhere: a \`.png\` file and its path, never \`html_render\`.
- Call \`preview_*\` (not \`html_preview\`) only when the current request asks for browser work or names a page or tab, or the task needs a browser. An earlier ask does not carry to a later edit. Never check or show your own edit with them, even a visual or frontend edit, and even with a tab open (\`preview_snapshot\` too). Public pages: web fetch or search unless browser work was asked; then preview tools only, no web fetch. Close a tab you opened for your own check before you reply, unless the user asked for it or uses it.`,
];

export const T3_CODE_ORCHESTRATION_INSTRUCTIONS = `

${T3_CODE_ORCHESTRATION_SECTIONS.join("\n\n")}
`;

export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = `

## T3 Code browser

The \`preview_*\` tools are the browser you share with the user. Call \`preview_status\` first, then \`preview_open\` if no tab can be automated. Prefer snapshot locators over coordinates. Switch browsers only if the tools are absent or \`preview_open\` says unsupported, the user asks, or two preview calls fail on one step. Then quote the error and switch.
`;

// ACP only: some ACP agents accept the injected MCP server but never expose
// its tools, so they need the terminal transport other harnesses never use.
const T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS = `ACP fallback: if the T3 tools are absent and \`T3_ACP_MCP_NODE\` is present, call them through the terminal: \`ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" \${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call orchestrator_capabilities '{}'\` (\`T3_ACP_MCP_ENTRYPOINT\` is unset for a standalone executable). Delegate with \`acp-mcp-call delegate_task '{"task":"...","target":{"providerInstanceId":"...","model":"..."},"mode":"async","clientRequestId":"..."}'\`.`;

const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Default

Prefer making reasonable assumptions and carrying out the user's request. Ask a concise question only when a missing user decision would materially change the result. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = `## T3 Code interaction mode: Plan

Investigate with read-only actions and do not edit files or otherwise execute the implementation. Resolve discoverable facts before asking questions. When the requirements are decision complete, return a concrete implementation plan and do not start implementing it. Treat this mode as active until T3 Code supplies a different interaction-mode instruction.`;

export interface T3AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasT3Mcp: boolean;
}

/** ACP lacks system/developer fields; inject context on first prompt and tool/mode changes. */
export function t3AcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: T3AcpInstructionState;
  readonly previousState?: T3AcpInstructionState;
}): string {
  // Native slash commands must remain at the start of the prompt.
  if (input.prompt.trimStart().startsWith("/")) return input.prompt;
  if (
    input.previousState?.interactionMode === input.state.interactionMode &&
    input.previousState.hasT3Mcp === input.state.hasT3Mcp
  ) {
    return input.prompt;
  }
  const instructions = [
    input.state.interactionMode === "plan"
      ? T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS
      : T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS,
    ...(input.state.hasT3Mcp
      ? [
          T3_CODE_BROWSER_TOOL_INSTRUCTIONS.trim(),
          T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
          T3_CODE_ACP_MCP_FALLBACK_INSTRUCTIONS,
        ]
      : []),
  ];
  return `<t3_code_instructions>\n${instructions.join("\n\n")}\n</t3_code_instructions>\n\n<user_request>\n${input.prompt}\n</user_request>`;
}

function prependT3OrchestrationInstructions(prompt: string): string {
  return `<t3_code_orchestration_instructions>${T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim()}</t3_code_orchestration_instructions>\n\n<user_request>\n${prompt}\n</user_request>`;
}

export function t3OrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasT3Mcp: boolean;
}): string {
  return input.runOrdinal === 1 && input.hasT3Mcp
    ? prependT3OrchestrationInstructions(input.prompt)
    : input.prompt;
}

export function t3OrchestrationSystemPrompt(hasT3Mcp: boolean): string | undefined {
  return hasT3Mcp ? T3_CODE_ORCHESTRATION_INSTRUCTIONS : undefined;
}
