export async function register() {
  // Only run in Node.js runtime (not Edge), and not during build
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV !== "test") {
    const { ensureStatsLoaded } = await import("@/lib/usageDb.js");
    ensureStatsLoaded().catch((err) => {
      console.warn("[instrumentation] Failed to pre-warm usage stats:", err.message);
    });
  }
}
