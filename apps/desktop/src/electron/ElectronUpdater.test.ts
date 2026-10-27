import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { VerifyUpdateCodeSignature } from "electron-updater";
import { vi } from "vite-plus/test";

const { autoUpdaterMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    channel: "latest",
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    verifyUpdateCodeSignature: undefined as VerifyUpdateCodeSignature | undefined,
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

import * as ElectronUpdater from "./ElectronUpdater.ts";

describe("ElectronUpdater", () => {
  it.effect("downloads the update when the first Windows signature checks time out", () =>
    Effect.gen(function* () {
      const publisherNames = ["T3 Tools Inc"];
      const installerPath = "C:\\updater\\pending\\temp-T3-Code-x64.exe";
      // execFile marks the error killed when the verifier exceeds its 20-second timeout.
      const timedOut = () =>
        Object.assign(new Error("Command failed: powershell.exe"), { killed: true });
      const verify = vi
        .fn<VerifyUpdateCodeSignature>()
        .mockRejectedValueOnce(timedOut())
        .mockRejectedValueOnce(timedOut())
        .mockRejectedValueOnce(timedOut())
        .mockResolvedValueOnce(null);
      autoUpdaterMock.verifyUpdateCodeSignature = verify;
      autoUpdaterMock.downloadUpdate.mockImplementationOnce(async () => {
        // NsisUpdater reads the current verifier and accepts only null as a valid signature.
        const rejection = await autoUpdaterMock.verifyUpdateCodeSignature!(
          publisherNames,
          installerPath,
        );
        if (rejection !== null) throw new Error(`Invalid signature: ${rejection}`);
        return [];
      });
      const updater = yield* ElectronUpdater.ElectronUpdater;

      yield* updater.downloadUpdate;

      assert.deepEqual(
        verify.mock.calls,
        Array.from({ length: 4 }, () => [publisherNames, installerPath]),
      );
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );
});
