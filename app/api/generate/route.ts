import { runPipeline, type PipelineEvent } from "@/lib/pipeline/run";
import { slugify } from "@/lib/pipeline/resolve";
import { getGuide } from "@/lib/storage";

// Live generation can take a few minutes on free-tier models.
export const maxDuration = 300;

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_GENERATIONS || 2);
let running = 0;

/**
 * POST /api/generate  { query: string, force?: boolean }
 * Streams Server-Sent Events: stage / progress / done / error.
 * (EventSource is GET-only, so the client reads this stream with fetch.)
 */
export async function POST(req: Request) {
  let body: { query?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON: {\"query\": \"app name or URL\"}" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 200) {
    return Response.json({ error: "query must be an app name or URL (2-200 characters)" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const sse = (e: PipelineEvent | { type: "cached"; slug: string; path: string }) =>
    encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

  // Already in the library (or generated before)? Return it instead of spending model quota.
  const existing = body.force === true ? null : await getGuide(slugify(query));
  if (existing) {
    const slug = existing.guide.app.slug;
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(sse({ type: "cached", slug, path: `/guides/${slug}` }));
          c.close();
        },
      }),
      { headers: sseHeaders() },
    );
  }

  if (running >= MAX_CONCURRENT) {
    return Response.json({ error: "Another guide is being generated right now. Please try again in a minute." }, { status: 429 });
  }

  running++;
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true; // client went away; keep running so the guide still gets saved
        }
      };
      const heartbeat = setInterval(() => send(encoder.encode(": keep-alive\n\n")), 15_000);
      try {
        await runPipeline(query, (e) => send(sse(e)));
      } catch {
        // runPipeline already emitted an error event
      } finally {
        clearInterval(heartbeat);
        running--;
        if (!closed) controller.close();
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}
