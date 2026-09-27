import { act } from "@/lib/server/monitor";

const ACTIONS = ["free-comfy", "unload-llm", "stop-sam"] as const;

export async function POST(req: Request) {
  const { action } = (await req.json()) as { action: (typeof ACTIONS)[number] };
  if (!ACTIONS.includes(action)) return Response.json({ error: "unknown action" }, { status: 400 });
  try {
    await act(action);
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
