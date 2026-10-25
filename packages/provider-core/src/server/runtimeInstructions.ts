const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to, as your next call: one link_pull_request per PR, full URL, every stack layer. Skip PRs you only read, review, or score, or that are only background. A link persists. Do not repeat it. Watch only if asked to monitor or babysit, or you must wait for checks or reviews to act. Creation, pending checks, or a merge ask alone is not enough. If ready, act. If you must wait, your first tool call is watch_pull_request, before reads, checks, or branch updates, even after unwatching. Never wait with sleep, gh --watch, loops, Monitor, or ScheduleWakeup. Delegated children never watch or poll, even if the brief says babysit: link, then report at once: PR URL, head SHA, check state. On a wake, act or end your turn. Do not re-watch or list. Before handback, call unwatch_pull_request on watched PRs.
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
