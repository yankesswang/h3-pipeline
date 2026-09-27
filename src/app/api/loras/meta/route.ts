import { saveLoraMeta } from "@/lib/server/loras";

export async function PUT(req: Request) {
  const b = (await req.json()) as { name: string; note: string; defaultStrength: number };
  saveLoraMeta(b.name, b.note ?? "", Number(b.defaultStrength) || 1);
  return new Response(null, { status: 204 });
}
