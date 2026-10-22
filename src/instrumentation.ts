export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.VITEST ||
    process.env.NODE_ENV === "test" ||
    process.env.JOBS_ENABLED === "false"
  )
    return
  const { startScheduler } = await import("@/server/jobs/scheduler")
  startScheduler()
}
