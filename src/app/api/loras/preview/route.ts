import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { findPreview } from "@/lib/server/loras";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export async function GET(req: NextRequest) {
  const p = await findPreview(req.nextUrl.searchParams.get("name") ?? "");
  if (!p) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(p), {
    headers: { "content-type": TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream", "cache-control": "max-age=3600" },
  });
}
