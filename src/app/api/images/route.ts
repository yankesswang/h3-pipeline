import type { NextRequest } from "next/server";
import { listImages } from "@/lib/server/repo";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return Response.json(
    listImages({
      before: Number(sp.get("before")) || undefined,
      limit: Math.min(Number(sp.get("limit")) || 60, 200),
      favorites: sp.get("favorites") === "1",
      q: sp.get("q") || undefined,
    }),
  );
}
