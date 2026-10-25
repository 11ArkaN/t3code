import type { ProviderInteractionMode } from "@t3tools/contracts";

// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
export const T3_CODE_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## T3 Code orchestration

Ordinary coding tasks need no T3 tools.

- Use \`delegate_task\` for every subagent or delegate in T3 Code, including same-provider work and any named model. Never use native subagent tools, native agent types, or Workflow for delegated work here, even if a native agent claims the requested model. Call \`orchestrator_capabilities\` once first to pick the provider, model, and options. Reuse that result until a call fails or the user says providers changed. Put model settings in \`target.options\`, not only in the prompt. Use one delegate per model the user names.
- For independent T3 delegated review rounds, call \`delegate_task\` again. That includes asking a reviewer to confirm a fix. Put the brief, prior findings, and open objections in the new task. Never send a new round with \`t3_thread_send\` to a \`childThreadId\`. Fix small follow-ups and nits yourself; do not start a review round for them.
- After an async delegate, end your turn. Completion wakes you. Do not poll with \`task_status\`, \`sleep\`, watchers, Monitor, or ScheduleWakeup. If \`delegate_task\` fails or a provider is unavailable, report that. Never fall back to native subagents, Workflow, or provider CLIs in the shell.
- If you are a delegated child or native subagent, do the work yourself. Do not delegate further unless your task says to.
- For a child task in its own checkout, set \`isolation:"worktree"\`. Stop delegates with \`task_cancel\`.`,
  `- \`t3_thread_launch\` and \`create_threads\` make new top-level threads. Use them only when the user asks for a separate or new thread. "Subagent", "delegate", and "parallel" never mean a new thread. For a new thread in its own worktree, set \`workspaceStrategy\` on \`t3_thread_launch\`. Never tell an agent to run \`git worktree add\`. No \`workspaceStrategy\` means the project root, not your worktree. \`t3_worktree_handoff\` moves this thread only.
- Given a thread id, read it with \`t3_thread_read\` before you answer about it. Mention a thread only as \`[title](t3-thread://v1/<threadId>)\` with its exact id. Never give a bare thread id.
- When a tool here needs a secret, call \`request_secret\` and pass its \`secretRef\` to that tool. Never ask for a secret in chat or invent one. Asked to schedule work? Call \`schedule_task\`. Do not run the job first.
- Tool names may carry an MCP prefix. If T3 tools do not show in a first scan, try the known tool name once before you say they are absent.`,
  `### Visuals and the preview browser

- To show a chart, table, diagram, or mockup in this thread, build one HTML page, check it with \`html_preview\`, then show it with \`html_render\`. Do not serve the page, open it in the preview, or save charts into a site instead. If the user wants an image file to use elsewhere, give a \`.png\` file, not an inline render.
- Use \`preview_*\` tools only when the user asks for browser work or names a page or tab, or the task cannot be done without a browser. For public pages, use web fetch or search. Do not open the preview just to check your own edit. Close a preview tab you opened when you finish with it, unless the user is using it.`,
];

export const T3_CODE_ORCHESTRATION_INSTRUCTIONS = `

${T3_CODE_ORCHESTRATION_SECTIONS.join("\n\n")}
`;

export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = `

## T3 Code browser

The \`preview_*\` tools are the browser you share with the user. When you use them, call \`preview_status\` first, then \`preview_open\` if no tab can be automated. A closed preview is not a dead end. Prefer snapshot locators over coordinates. Read any listed tab. Act only on your own tab, or an \`unclaimed\` tab with no human in control. Read a \`human\` tab with \`preview_snapshot\`. Pass a \`profileId\` from \`preview_status\` to \`preview_open\` for saved logins. Switch to another browser only when the preview tools are absent or \`preview_open\` says unsupported, when the user or a named workflow asks for one, or after two failed preview calls on the same step. Then quote the error and switch without asking.
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
