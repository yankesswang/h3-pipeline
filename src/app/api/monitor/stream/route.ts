import type { MonitorSample } from "@/lib/shared/monitor";
import { history, watch } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";

// Server-sent events: the history first, then a sample every 2 s.
export function GET(req: Request) {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (type: string, data: unknown) => controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      send("history", history());
      stop = watch((s: MonitorSample) => send("sample", s));
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
}
