import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  TextGenerationError,
  ModelSelection,
  type ReviewCommitDescriptionsInput,
  type GitCommandError,
  type ReviewCommitDescriptionsResult,
  type ReviewCommitDescriptionsError,
  type ReviewBranchCommitsInput,
  type ReviewBranchCommitsResult,
  type ReviewDiffFileContentsInput,
  type ReviewDiffFileContentsResult,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

type PendingDescription = Deferred.Deferred<string, TextGenerationError | GitCommandError>;
const encodeModelSelection = Schema.encodeSync(Schema.fromJsonString(ModelSelection));

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getBranchCommits: (
      input: ReviewBranchCommitsInput,
    ) => Effect.Effect<ReviewBranchCommitsResult, ReviewDiffPreviewError>;
    readonly generateCommitDescriptions: (
      input: ReviewCommitDescriptionsInput,
    ) => Effect.Effect<ReviewCommitDescriptionsResult, ReviewCommitDescriptionsError>;
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
  }
>()("t3/review/ReviewService") {}

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  // Finished descriptions and in-flight requests by repository, sha and model, least recent first.
  const descriptionsByKey = new Map<string, PendingDescription>();

  const canonicalizePath = (value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(resolvedPath)
            : Effect.fail(
                new VcsRepositoryDetectionError({
                  operation: "ReviewService.assertWorkspaceBoundCwd.canonicalizePath",
                  cwd: resolvedPath,
                  detail: "Failed to resolve a path while validating the review workspace.",
                  cause,
                }),
              ),
      }),
    );
  };

  const assertWorkspaceBoundCwd = Effect.fn("ReviewService.assertWorkspaceBoundCwd")(function* (
    operation:
      | "ReviewService.getBranchCommits"
      | "ReviewService.generateCommitDescriptions"
      | "ReviewService.getDiffPreview"
      | "ReviewService.getDiffFileContents",
    cwd: string,
  ) {
    const [candidate, workspaceRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
    ]);
    if (
      KnownWorkspaces.isWithinRoot(path, candidate, workspaceRoot) ||
      (yield* knownWorkspaces.contains(candidate))
    ) {
      return;
    }

    return yield* new VcsRepositoryDetectionError({
      operation,
      cwd,
      detail:
        operation === "ReviewService.getDiffPreview"
          ? "Review diff preview cwd must stay within the configured workspace root."
          : operation === "ReviewService.getBranchCommits"
            ? "Review commit list cwd must stay within the configured workspace root."
            : "Review diff file contents cwd must stay within the configured workspace root.",
    });
  });

  const getBranchCommits: ReviewService["Service"]["getBranchCommits"] = Effect.fn(
    "ReviewService.getBranchCommits",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getBranchCommits", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) return { commits: [], truncated: false };
    if (handle.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getBranchCommits",
        kind: handle.kind,
        detail: "Review commit lists require a Git repository.",
      });
    }
    return yield* git.getReviewBranchCommits(input);
  });

  const generateCommitDescriptions: ReviewService["Service"]["generateCommitDescriptions"] =
    Effect.fn("ReviewService.generateCommitDescriptions")(function* (input) {
      yield* assertWorkspaceBoundCwd("ReviewService.generateCommitDescriptions", input.cwd);
      const invalidThread = () =>
        new VcsRepositoryDetectionError({
          operation: "ReviewService.generateCommitDescriptions",
          cwd: input.cwd,
          detail: "The review thread does not own this workspace.",
        });
      const thread = yield* threads.getThreadShell(input.threadId).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateCommitDescriptions",
              detail: "Could not read the review thread.",
              cause,
            }),
        ),
      );
      if (!thread) return yield* invalidThread();
      const project = yield* projects.getShell(thread.projectId).pipe(
        Effect.map(Option.getOrNull),
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateCommitDescriptions",
              detail: "Could not read the review project.",
              cause,
            }),
        ),
      );
      if (!project) return yield* invalidThread();
      const [candidate, expected] = yield* Effect.all([
        canonicalizePath(input.cwd),
        canonicalizePath(thread.worktreePath ?? project.workspaceRoot),
      ]);
      if (candidate !== expected) return yield* invalidThread();

      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateCommitDescriptions",
              detail: "Could not read text generation settings.",
              cause,
            }),
        ),
      );
      const modelSelection = resolveProjectSettings(settings, thread.projectId).settings
        .textGenerationModelSelection;
      const modelKey = encodeModelSelection(modelSelection);
      const resolved = yield* git.resolveReviewCommits({
        cwd: input.cwd,
        shas: [...new Set(input.shas)],
      });
      const descriptions = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const claimed: Array<{ sha: string; key: string; description: PendingDescription }> = [];
          const requested = resolved.commits.map(({ sha }) => {
            const key = `${resolved.repositoryKey}\0${sha}\0${modelKey}`;
            const known = descriptionsByKey.get(key);
            if (known) {
              descriptionsByKey.delete(key);
              descriptionsByKey.set(key, known);
              return { sha, description: known };
            }
            const description: PendingDescription = Deferred.makeUnsafe();
            descriptionsByKey.set(key, description);
            if (descriptionsByKey.size > 512) {
              descriptionsByKey.delete(descriptionsByKey.keys().next().value!);
            }
            claimed.push({ sha, key, description });
            return { sha, description };
          });
          if (claimed.length > 0) {
            const generated = yield* restore(
              git
                .getReviewCommitDescriptionContext({
                  cwd: input.cwd,
                  shas: claimed.map((item) => item.sha),
                })
                .pipe(
                  Effect.flatMap((context) =>
                    textGeneration.generateCommitDescriptions({
                      cwd: input.cwd,
                      commits: context.commits,
                      modelSelection,
                    }),
                  ),
                ),
            ).pipe(Effect.exit);
            const bySha = Exit.isSuccess(generated)
              ? new Map(generated.value.descriptions.map((item) => [item.sha, item.description]))
              : null;
            for (const item of claimed) {
              const description = bySha?.get(item.sha);
              if (description !== undefined) {
                yield* Deferred.succeed(item.description, description);
                continue;
              }
              // A failure is not cached, so the next request asks the model again.
              if (descriptionsByKey.get(item.key) === item.description) {
                descriptionsByKey.delete(item.key);
              }
              yield* Exit.isFailure(generated)
                ? Deferred.failCause(item.description, generated.cause)
                : Deferred.fail(
                    item.description,
                    new TextGenerationError({
                      operation: "generateCommitDescriptions",
                      detail: "The model returned incomplete commit descriptions.",
                    }),
                  );
            }
          }
          return yield* restore(
            Effect.forEach(requested, ({ sha, description }) =>
              Deferred.await(description).pipe(Effect.map((text) => ({ sha, description: text }))),
            ),
          );
        }),
      );
      return { modelSelection, descriptions };
    });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getDiffPreview", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    return yield* git.getReviewDiffPreview(input);
  });

  const getDiffFileContents: ReviewService["Service"]["getDiffFileContents"] = Effect.fn(
    "ReviewService.getDiffFileContents",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getDiffFileContents", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffFileContents",
        kind: handle?.kind ?? "unknown",
        detail: "Unchanged diff expansion currently requires a Git repository.",
      });
    }

    return yield* git.getReviewDiffFileContents(input);
  });

  return ReviewService.of({
    getBranchCommits,
    generateCommitDescriptions,
    getDiffPreview,
    getDiffFileContents,
  });
});

export const layer = Layer.effect(ReviewService, make);
