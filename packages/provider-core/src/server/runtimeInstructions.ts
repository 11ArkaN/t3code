const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link every PR you create, take over, or push to with link_pull_request. Full URL, every stack layer, right away. Host tools do not link for you. Do not link PRs you only read, review, or score, or PRs named only as background. As a delegated child, never watch or poll a PR. End your report with its URL and head SHA, plus check and review state. Otherwise, if checks or reviews are still pending on an open PR and you would wait, babysit, or merge when ready, call watch_pull_request first, before checks, diffs, or branch updates, then end your turn after any push. Watch again if you had unwatched. Never wait with sleep, gh --watch, loops, Monitor, or ScheduleWakeup. A watch stays on across wakes: act or end your turn. Do not re-watch, re-link, or list PRs. Before you hand work back, call unwatch_pull_request.
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
