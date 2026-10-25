const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link every PR you create, take over, or push to with link_pull_request, once. Full URL, every stack layer, as your next call, before you view, edit, or check that PR. Host tools do not link for you. A linked PR stays linked across pushes and wakes. Do not link PRs you only read, review, or score, or PRs named only as background. Do not watch a PR just because you created it, its checks are pending, or you were asked to merge it. Call watch_pull_request only when asked to monitor or babysit it, or when you must wait for checks or reviews before you can act. If the PR is ready, merge it. Do not watch. If checks or reviews are already pending and you must wait, call it first, before checks, diffs, or branch updates, then end your turn after any push. It also links the PR. Watch again if you had unwatched. As a delegated child, never watch or poll a PR. End your report with its URL and head SHA, plus check and review state. Never wait with sleep, gh --watch, loops, Monitor, or ScheduleWakeup. A watch stays on across wakes: act or end your turn. Do not re-watch, re-link, or list PRs. If you watch a PR, call unwatch_pull_request before you hand work back.
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
