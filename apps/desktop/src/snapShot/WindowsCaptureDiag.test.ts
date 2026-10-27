import * as HostProcess from "@t3tools/shared/HostProcess";
import { it } from "vite-plus/test";

it.skipIf(HostProcess.Platform.defaultValue() !== "win32")("diag: xa11y and raw GDI", async () => {
  const { DataType, load, open } = await import("ffi-rs");
  open({ library: "u", path: "user32.dll" });
  open({ library: "g", path: "gdi32.dll" });
  open({ library: "k", path: "kernel32.dll" });
  const big = (library: string, funcName: string, params: bigint[]) =>
    load({ library, funcName, retType: DataType.BigInt, paramsType: params.map(() => DataType.BigInt), paramsValue: params }) as bigint;
  const sid = Buffer.alloc(4);
  load({ library: "k", funcName: "ProcessIdToSessionId", retType: DataType.I32, paramsType: [DataType.U32, DataType.U8Array], paramsValue: [process.pid, sid] });
  console.log("DIAG session", sid.readUInt32LE(0));
  console.log("DIAG virtual screen", [76, 77, 78, 79].map((m) => load({ library: "u", funcName: "GetSystemMetrics", retType: DataType.I32, paramsType: [DataType.I32], paramsValue: [m] })));
  try {
    const imported = await import("@crowecawcaw/xa11y");
    const xa11y = (imported as unknown as { default?: typeof imported }).default ?? imported;
    const shot = await xa11y.screenshot({ region: { x: 0, y: 0, width: 5, height: 3 } });
    console.log("DIAG xa11y ok", shot.width, shot.height);
  } catch (error) {
    console.log("DIAG xa11y failed", String(error));
  }
  for (const dpi of [false, true]) {
    if (dpi) console.log("DIAG dpi ctx", big("u", "SetThreadDpiAwarenessContext", [-4n]));
    const screen = big("u", "GetDC", [0n]);
    const memory = big("g", "CreateCompatibleDC", [screen]);
    const bitmap = load({ library: "g", funcName: "CreateCompatibleBitmap", retType: DataType.BigInt, paramsType: [DataType.BigInt, DataType.I32, DataType.I32], paramsValue: [screen, 5, 3] }) as bigint;
    const previous = big("g", "SelectObject", [memory, bitmap]);
    const result = load({
      library: "g", funcName: "BitBlt", retType: DataType.I32, errno: true,
      paramsType: [DataType.BigInt, DataType.I32, DataType.I32, DataType.I32, DataType.I32, DataType.BigInt, DataType.I32, DataType.I32, DataType.U32],
      paramsValue: [memory, 0, 0, 5, 3, screen, 0, 0, 0x00cc0020],
    });
    console.log("DIAG bitblt dpi=" + dpi, JSON.stringify({ screen: String(screen), memory: String(memory), bitmap: String(bitmap), previous: String(previous), result }));
    big("g", "SelectObject", [memory, previous]);
    big("g", "DeleteObject", [bitmap]);
    big("g", "DeleteDC", [memory]);
    big("u", "ReleaseDC", [0n, screen]);
  }
});
