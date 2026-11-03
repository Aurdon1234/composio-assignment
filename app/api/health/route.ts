// Reports which integrations are configured (booleans only, never values).
export async function GET() {
  return Response.json({
    llm: process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null,
    search: process.env.TAVILY_API_KEY ? "tavily" : "duckduckgo-fallback",
    blob_storage: !!process.env.BLOB_READ_WRITE_TOKEN,
  });
}
