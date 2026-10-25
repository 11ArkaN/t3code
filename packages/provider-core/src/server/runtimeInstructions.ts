const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to: one link_pull_request call per PR, full URL, every stack layer, as your next call. Host tools do not link for you. A link persists across pushes and wakes. Do not repeat it. Skip PRs you only read, review, or score, and PRs named only as background. Watch only if asked to monitor or babysit, or you must wait for checks or reviews to act. Creation, pending checks, or a merge ask alone is not enough. If ready, act. Do not watch. If you must wait, call watch_pull_request before checks or branch updates, then end your turn after any push. It also links. If you unwatched earlier, watch again. Delegated children never watch or poll. End your report with the PR URL, head SHA, and check and review state. Never wait with sleep, gh --watch, loops, Monitor, or ScheduleWakeup. A watch persists across wakes. On a wake, act or end your turn. Do not re-link, re-watch, or list PRs. Before handback, call unwatch_pull_request on any PR you watch.
</pull_request_linking>`;

/** Omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
