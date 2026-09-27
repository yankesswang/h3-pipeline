import { analyzeWorkflow, parseWorkflow } from "@/lib/server/tools";

// Look at a pasted workflow and propose which inputs to expose.
export async function POST(req: Request) {
  const b = (await req.json()) as { workflow: unknown };
  try {
    const workflow = parseWorkflow(b.workflow);
    return Response.json({ workflow, ...(await analyzeWorkflow(workflow)) });
  } catch (e) {
    const msg = e instanceof SyntaxError ? "JSON 格式有誤：" + e.message : e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 400 });
  }
}
