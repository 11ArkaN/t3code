import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import ShellStopRequestIndex from "./Migrations/068_ShellStopRequestIndex.ts";
import ThreadMessageSearch from "./Migrations/069_ThreadMessageSearch.ts";

const PREVIEW_PEER_LINK_HISTORY = [
  [68, "PeerLinks"],
  [69, "PeerLinkFence"],
  [70, "WaitingLinkRequestIndex"],
] as const;

// Previews 3511/3516 recorded peer links at 68-70; keep their schema at 3702's ids 70-72.
export const reconcilePeerLinkPreviewMigration = Effect.fn("reconcilePeerLinkPreviewMigration")(
  function* (manifest: ReadonlyArray<readonly [number, string]>) {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        if (tables.length === 0) return [];
        const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations
          WHERE migration_id >= 55 ORDER BY migration_id
        `;
        const expected = [
          ...manifest.filter(([id]) => id >= 55 && id < 68),
          ...PREVIEW_PEER_LINK_HISTORY,
        ];
        const matches =
          history.length === expected.length &&
          history.every(
            (row, index) =>
              row.migration_id === expected[index]![0] && row.name === expected[index]![1],
          );
        // Any other history is left untouched for the divergence guard to reject.
        if (!matches) return [];
        // Move the latest entry first to avoid primary-key collisions.
        for (const [id] of PREVIEW_PEER_LINK_HISTORY.toReversed()) {
          yield* sql`UPDATE effect_sql_migrations SET migration_id = ${id + 2} WHERE migration_id = ${id}`;
        }
        yield* ShellStopRequestIndex;
        yield* ThreadMessageSearch;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (68, 'ShellStopRequestIndex'), (69, 'ThreadMessageSearch')
        `;
        return [
          [68, "ShellStopRequestIndex"],
          [69, "ThreadMessageSearch"],
        ] as const;
      }),
    );
  },
);
