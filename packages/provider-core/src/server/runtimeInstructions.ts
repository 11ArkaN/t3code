const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
T3 links a PR that one gh pr create or glab mr create command prints. Call link_pull_request for any other PR you create (in a loop, via an API), take over, or push to. Skip PRs you only read, review, or mention. When asked to babysit or monitor, or when your task, such as a merge, waits on checks or reviews, even after an earlier unwatch: push any needed branch update, call watch_pull_request, and end your turn. Otherwise act now or hand back. Never wait with sleep, loops, gh --watch, Monitor, or ScheduleWakeup. A delegated child never polls, even when asked to babysit, and ends with: PR <full URL>, head <SHA>, checks and reviews <state>. Before handback, call unwatch_pull_request on every PR you watch.
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
