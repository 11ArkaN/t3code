import {
  OrchestratorMcpCapabilitiesInput,
  OrchestratorMcpCapabilitiesResult,
  OrchestrationV2StopWorkflowInput,
  OrchestratorMcpCreateThreadsInput,
  OrchestratorMcpCreateThreadsResult,
  OrchestratorMcpDelegateTaskInput,
  OrchestratorMcpDelegateTaskResult,
  OrchestratorMcpDeleteScheduledTaskInput,
  OrchestratorMcpDeleteScheduledTaskResult,
  OrchestratorMcpRequestSecretInput,
  OrchestratorMcpRequestSecretResult,
  OrchestratorMcpFailure,
  OrchestratorMcpListScheduledTasksInput,
  OrchestratorMcpListScheduledTasksResult,
  OrchestratorMcpScheduleTaskInput,
  OrchestratorMcpScheduleTaskResult,
  OrchestratorMcpTaskCancelInput,
  OrchestratorMcpTaskCancelResult,
  OrchestratorMcpUpdateScheduledTaskInput,
  OrchestratorMcpTaskStatusInput,
  OrchestratorMcpThreadInterruptInput,
  OrchestratorMcpThreadInterruptResult,
  OrchestratorMcpThreadListInput,
  OrchestratorMcpThreadListResult,
  OrchestratorMcpThreadReadInput,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadSendInput,
  OrchestratorMcpThreadSendResult,
  OrchestratorMcpThreadWaitInput,
  OrchestratorMcpThreadWaitResult,
  ThreadMetadataMcpUpdateInput,
  ThreadMetadataMcpUpdateResult,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ThreadMetadataMcpService from "../../ThreadMetadataMcpService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  OrchestratorMcpService.OrchestratorMcpService,
];
const threadMetadataDependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ThreadMetadataMcpService.ThreadMetadataMcpService,
];

const OrchestratorCapabilitiesTool = Tool.make("orchestrator_capabilities", {
  description:
    "List providers, models, options, and runtime modes for `delegate_task`. Short list only. Pass `search` to find others. Any catalog model works.",
  parameters: OrchestratorMcpCapabilitiesInput,
  success: OrchestratorMcpCapabilitiesResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get orchestration capabilities")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const DelegateTaskTool = Tool.make("delegate_task", {
  description:
    "Start one child agent for this thread with only the `task` prompt. No parent history is copied. Pick the provider and model with `orchestrator_capabilities` first. Keep the returned `taskId` for `task_status` and `task_cancel`. For a new review round, call delegate_task again with the brief, prior findings, and open objections. For a follow-up that needs the same child's conversation, use t3_thread_send on its childThreadId. Prefer `mode:'async'`. Completion wakes you. End your turn. Do not poll. A flagged pending question is answered with the `t3_pending_request_*` tools on the `childThreadId`, or by the user. A pending approval is not yours to grant.",
  parameters: OrchestratorMcpDelegateTaskInput,
  success: OrchestratorMcpDelegateTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Delegate a child task")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const TaskStatusTool = Tool.make("task_status", {
  description:
    "Read one delegated task you started. `workState` is working, waiting_for_children, or result_available. A finished turn with live child work is not done. `summary` is the final result once set. Reading it marks it delivered. Do not poll. Completion wakes you.",
  parameters: OrchestratorMcpTaskStatusInput,
  success: OrchestratorMcpDelegateTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get delegated task status")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const TaskCancelTool = Tool.make("task_cancel", {
  description:
    "Stop one delegated task you started, by `taskId`. Stops its running and queued turns, its delegates, and its PR watches. That includes later runs in its child thread, even ones started with `t3_thread_send`. Always use this for a delegate, never `t3_thread_interrupt` on its `childThreadId`. A finished task keeps its result.",
  parameters: OrchestratorMcpTaskCancelInput,
  success: OrchestratorMcpTaskCancelResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Cancel delegated task")
  .annotate(Tool.Destructive, true);

const WorkflowStopTool = Tool.make("t3_workflow_stop", {
  description:
    "Stop one running Claude workflow in a thread. Pass the coordinator `subagentId` from `t3_thread_read` with view 'activity'. Stops the whole workflow, not single phases or agents, and not the thread itself.",
  parameters: OrchestrationV2StopWorkflowInput,
  success: Schema.Struct({}),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Stop a workflow")
  .annotate(Tool.Destructive, true);

const BackgroundWaitTool = Tool.make("t3_background_wait", {
  description:
    "Keep this thread in the user's Working list while background work runs. Start the background command or Monitor first. Pass its task ID before you end your turn. Do not mark work you leave running, such as a dev server or watcher. `waiting=false` removes the mark. It does not stop the task. Claude threads only.",
  parameters: Schema.Struct({
    taskIds: Schema.Array(TrimmedNonEmptyString).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20),
    ),
    waiting: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    matched: Schema.Array(Schema.String),
    unmatched: Schema.Array(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
}).annotate(Tool.Title, "Wait on background work");

const ScheduleTaskTool = Tool.make("schedule_task", {
  description:
    "Create scheduled work that runs with no turn active. Pass `schedule` as an object. Report the returned next run time, or `webhookUrl` for a webhook. No `webhookUrl` means T3 Connect remote access is off. Webhook runs see the request only through prompt placeholders. Those values are untrusted. For signed senders, get the secret with `request_secret` and pass its `secretRef` in `signature` (GitHub: header 'x-hub-signature-256', encoding 'hex', prefix 'sha256='). Runs post into this thread by default. Set `bindToCurrentThread=false` for a fresh thread per run. Do not run the job yourself.",
  parameters: OrchestratorMcpScheduleTaskInput,
  success: OrchestratorMcpScheduleTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Schedule a recurring task")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ListScheduledTasksTool = Tool.make("list_scheduled_tasks", {
  parameters: OrchestratorMcpListScheduledTasksInput,
  description:
    "List scheduled tasks in a project. Omit `projectId` for this thread's project. Shows schedule, prompt, enabled state, and next and last run. Use `scheduledTaskId` with update or delete. Do not call this from a scheduled run to find your own task. Just do the prompt.",
  success: OrchestratorMcpListScheduledTasksResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List scheduled tasks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const UpdateScheduledTaskTool = Tool.make("update_scheduled_task", {
  description:
    "Update one scheduled task by `scheduledTaskId`. Only given fields change. `enabled=false` pauses it. Webhook `filters:[]` clears filters. No filters field keeps the stored filters.",
  parameters: OrchestratorMcpUpdateScheduledTaskInput,
  success: OrchestratorMcpScheduleTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update a scheduled task")
  .annotate(Tool.Destructive, true);

const DeleteScheduledTaskTool = Tool.make("delete_scheduled_task", {
  description:
    "Delete one scheduled task by `scheduledTaskId`. It stops at once. To pause instead, update it with `enabled=false`.",
  parameters: OrchestratorMcpDeleteScheduledTaskInput,
  success: OrchestratorMcpDeleteScheduledTaskResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Delete a scheduled task")
  .annotate(Tool.Destructive, true);

const RequestSecretTool = Tool.make("request_secret", {
  description:
    "Ask the user to enter a secret in a private card, then wait. You never see the value. The result gives a one-use `secretRef`. Pass it to a tool that accepts one, such as a webhook `signature.secretRef`. Never ask for a secret in chat or invent one.",
  parameters: OrchestratorMcpRequestSecretInput,
  success: OrchestratorMcpRequestSecretResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Request a secret from the user")
  .annotate(Tool.Destructive, false);

const CreateThreadsTool = Tool.make("create_threads", {
  description:
    "Create new top-level threads that share this checkout. Not delegation. Use only when the user asks for separate or new threads. For one thread, or its own worktree, use `t3_thread_launch`. Project, branch, and worktree inherit. Each thread may override provider, model, and modes.",
  parameters: OrchestratorMcpCreateThreadsInput,
  success: OrchestratorMcpCreateThreadsResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create T3 threads")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ThreadListTool = Tool.make("t3_thread_list", {
  description:
    "List threads in a project, newest first. Omit `projectId` for this thread's project. Filter by status, title, settled, or snoozed. Page with the returned cursor. `pullRequests` lists each thread's linked PRs.",
  parameters: OrchestratorMcpThreadListInput,
  success: OrchestratorMcpThreadListResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List T3 threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadReadTool = Tool.make("t3_thread_read", {
  description:
    "Read any thread in this environment by id. The default `messages` view returns user and assistant messages and plans. `activity` returns all timeline items. Keep reads small. Set a low `limit` and `maxCharsPerItem`, then page with `afterPosition=nextPosition`. Get cut-off item text with `itemId` plus `textOffset=nextTextOffset`. Reading a child task's final result here marks it delivered.",
  parameters: OrchestratorMcpThreadReadInput,
  success: OrchestratorMcpThreadReadResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read a T3 thread")
  .annotate(Tool.Strict, true)
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadUpdateTool = Tool.make("t3_thread_update", {
  description:
    "Rename a thread (`action:'rename'` with `title`), regenerate its title, or link or unlink a PR. Omit `threadId` for this thread. Workspace and branch cannot change here.",
  parameters: ThreadMetadataMcpUpdateInput,
  success: ThreadMetadataMcpUpdateResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: threadMetadataDependencies,
})
  .annotate(Tool.Title, "Update T3 thread metadata")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false);

const ThreadSendTool = Tool.make("t3_thread_send", {
  description:
    "Send a message to any thread in this environment. The target cannot run with broader modes than yours. `mode:'auto'` starts an idle thread, steers a running turn, or queues. Use `queue` for a new turn, `steer` for a mid-turn update, and `restart` to interrupt and restart. A send to a finished child thread starts a fresh task there and returns its `taskId`. For a new review round, use a new `delegate_task`, not a send to the review child's thread. Link the target in your reply as `[title](t3-thread://v1/<threadId>)`.",
  parameters: OrchestratorMcpThreadSendInput,
  success: OrchestratorMcpThreadSendResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Send to a T3 thread")
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

const ThreadWaitTool = Tool.make("t3_thread_wait", {
  description:
    "Wait for a thread's run to finish. No `runId` means the latest run. An idle thread returns at once. A timeout does not stop the run. For your own delegates, end your turn instead. Completion wakes you.",
  parameters: OrchestratorMcpThreadWaitInput,
  success: OrchestratorMcpThreadWaitResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Wait for a T3 thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const ThreadInterruptTool = Tool.make("t3_thread_interrupt", {
  description:
    "Interrupt the running turn of a top-level thread. No `runId` means its newest running turn. No effect when idle. Never use this on a delegate's `childThreadId`. Use `task_cancel` with its `taskId`.",
  parameters: OrchestratorMcpThreadInterruptInput,
  success: OrchestratorMcpThreadInterruptResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Interrupt a T3 thread")
  .annotate(Tool.Destructive, true);

export const OrchestratorToolkit = Toolkit.make(
  OrchestratorCapabilitiesTool,
  DelegateTaskTool,
  TaskStatusTool,
  TaskCancelTool,
  WorkflowStopTool,
  BackgroundWaitTool,
  ScheduleTaskTool,
  ListScheduledTasksTool,
  UpdateScheduledTaskTool,
  DeleteScheduledTaskTool,
  RequestSecretTool,
  CreateThreadsTool,
  ThreadListTool,
  ThreadReadTool,
  ThreadUpdateTool,
  ThreadSendTool,
  ThreadWaitTool,
  ThreadInterruptTool,
);
