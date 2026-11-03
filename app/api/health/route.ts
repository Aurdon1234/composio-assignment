import { list } from "@vercel/blob";
import { useBlob } from "@/lib/storage";

// Reports which integrations are configured (never secret values) and whether Blob auth works.
export async function GET() {
  let blob_check: string = "not configured";
  if (useBlob()) {
    try {
      const r = await list({ prefix: "guides/", limit: 50 });
      blob_check = `ok (${r.blobs.length} live guide(s) stored)`;
    } catch (e) {
      blob_check = `error: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`;
    }
  }
  return Response.json({
    llm: process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null,
    search: process.env.TAVILY_API_KEY ? "tavily" : "duckduckgo-fallback",
    blob_storage: process.env.BLOB_READ_WRITE_TOKEN ? "read-write token" : process.env.BLOB_STORE_ID ? "store id (OIDC)" : false,
    blob_check,
  });
}
