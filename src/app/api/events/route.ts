import type { ServerEvent } from "@/lib/shared/types";
import { bus } from "@/lib/server/queue";

export const dynamic = "force-dynamic";

// Server-sent events: job progress and newly saved images.
export function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: ServerEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 20_000);
      bus.on("event", send);
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", send);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
  });
}
