/**
 * Server boot hook. Validates production-critical env once, loudly, instead
 * of failing cryptically on first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const { assertProductionEnv } = await import("@/lib/env");
  const problems = assertProductionEnv();
  if (problems.length > 0) {
    for (const p of problems) console.error(`[boot] ${p}`);
  }
}
