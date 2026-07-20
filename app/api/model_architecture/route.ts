/**
 * app/api/model_architecture/route.ts — GET /api/model_architecture (PROJECT_SPEC §6,
 * CLAUDE.md §6).
 *
 * Serves the architecture diagram PNG from the public/ directory. The module names in the
 * diagram must match the frozen names (CLAUDE.md §3) and the `steps` trace. If the file is
 * missing we return a clear 500 JSON error rather than crashing the route.
 *
 * Reads from the filesystem, so it requires the Node runtime, not Edge. This is a read of a
 * static build asset shipped in the repo — not cross-call app state (CLAUDE.md §2).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const PNG_PATH = join(process.cwd(), "public", "architecture.png");

export async function GET(): Promise<Response> {
  try {
    const png = await readFile(PNG_PATH);
    // Uint8Array is a valid BodyInit; copy into a fresh ArrayBuffer to satisfy the
    // BlobPart/BodyInit typing across runtimes.
    const body = new Uint8Array(png);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        status: "error",
        error: `Architecture diagram could not be served: ${message}`,
      },
      { status: 500 },
    );
  }
}