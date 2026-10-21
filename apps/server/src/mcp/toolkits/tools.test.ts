import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";

import { AttachmentToolkit } from "./attachment/tools.ts";
import { DeviceToolkit } from "./device/tools.ts";
import { EnvironmentToolkit } from "./environment/tools.ts";
import { HtmlToolkit } from "./html/tools.ts";
import { OrchestratorToolkit } from "./orchestrator/tools.ts";
import { PreviewToolkit } from "./preview/tools.ts";
import { PreviewControlsToolkit } from "./previewControls/tools.ts";
import { ProjectToolkit } from "./project/tools.ts";
import { PullRequestsToolkit } from "./pullRequests/tools.ts";
import { ThreadToolkit } from "./thread/tools.ts";
import { WorktreeToolkit } from "./worktree/tools.ts";

interface JsonSchemaNode {
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly anyOf?: ReadonlyArray<JsonSchemaNode>;
}

const descriptionOf = (schema: JsonSchemaNode | undefined): string | undefined =>
  schema?.description ?? schema?.anyOf?.map(descriptionOf).find(Boolean);

const objectOf = (schema: JsonSchemaNode | undefined): JsonSchemaNode | undefined =>
  schema?.properties ? schema : schema?.anyOf?.map(objectOf).find(Boolean);

const missingDescriptions = (
  decoded: JsonSchemaNode | undefined,
  served: JsonSchemaNode | undefined,
  path: string,
): ReadonlyArray<string> =>
  Object.entries(objectOf(decoded)?.properties ?? {}).flatMap(([field, fieldSchema]) => {
    const servedField = objectOf(served)?.properties?.[field];
    const description = descriptionOf(fieldSchema);
    const missing =
      description !== undefined && descriptionOf(servedField) !== description
        ? [`${path}.${field}`]
        : [];
    return [...missing, ...missingDescriptions(fieldSchema, servedField, `${path}.${field}`)];
  });

const tools = [
  AttachmentToolkit,
  DeviceToolkit,
  EnvironmentToolkit,
  HtmlToolkit,
  OrchestratorToolkit,
  PreviewToolkit,
  PreviewControlsToolkit,
  ProjectToolkit,
  PullRequestsToolkit,
  ThreadToolkit,
  WorktreeToolkit,
].flatMap((toolkit) => Object.values(toolkit.tools) as Tool.Any[]);

// Agents receive the encoded-side JSON schema, so a description written with
// `.annotate` on a transformed field, such as a trimmed string, never reaches them.
it("serves every parameter description written on the decoded side", () => {
  const missing = tools.flatMap((tool) =>
    missingDescriptions(
      Schema.toJsonSchemaDocument(Schema.toType(tool.parametersSchema)).schema as JsonSchemaNode,
      Tool.getJsonSchema(tool) as JsonSchemaNode,
      tool.name,
    ),
  );
  expect(missing).toEqual([]);
});

it.each([
  ["delegate_task", "task"],
  ["delegate_task", "clientRequestId"],
  ["request_secret", "label"],
  ["schedule_task", "projectId"],
  ["link_pull_request", "url"],
  ["t3_worktree_handoff", "branch"],
  ["device_open", "deviceId"],
])("describes %s.%s to agents", (name, field) => {
  const tool = tools.find((candidate) => candidate.name === name);
  const served = tool && (Tool.getJsonSchema(tool) as JsonSchemaNode);
  expect(descriptionOf(served?.properties?.[field])).toBeTruthy();
});
