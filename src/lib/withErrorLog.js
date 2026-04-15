/**
 * Route handler middleware that logs all non-200 responses and uncaught exceptions.
 * Usage: export const POST = withErrorLog(async (request) => { ... });
 */
export function withErrorLog(handler) {
  return async (request, context) => {
    const label = `${request.method} ${new URL(request.url).pathname}`;
    try {
      const response = await handler(request, context);

      if (response.status !== 200) {
        const clone = response.clone();
        let body = "";
        try {
          body = await clone.text();
        } catch {
          body = "(unreadable body)";
        }
        console.error(`[ERROR RESPONSE] ${label} → ${response.status} | ${body.slice(0, 1000)}`);
      }

      return response;
    } catch (err) {
      console.error(`[EXCEPTION] ${label}`, err);
      return new Response(
        JSON.stringify({ error: { message: err?.message || "Internal server error" } }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  };
}
