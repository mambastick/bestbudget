import { afterEach, expect, it, vi } from "vitest"
import { register } from "./instrumentation"

const startScheduler = vi.hoisted(() => vi.fn())
vi.mock("@/server/jobs/scheduler", () => ({ startScheduler }))
afterEach(() => { vi.unstubAllEnvs(); startScheduler.mockClear() })
it("does not start jobs in build, Vitest, edge or when explicitly disabled", async () => {
  for (const patch of [
    { NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build", VITEST: "", NODE_ENV: "production", JOBS_ENABLED: "true" },
    { NEXT_RUNTIME: "nodejs", NEXT_PHASE: "", VITEST: "true", NODE_ENV: "production", JOBS_ENABLED: "true" },
    { NEXT_RUNTIME: "edge", NEXT_PHASE: "", VITEST: "", NODE_ENV: "production", JOBS_ENABLED: "true" },
    { NEXT_RUNTIME: "nodejs", NEXT_PHASE: "", VITEST: "", NODE_ENV: "production", JOBS_ENABLED: "false" },
    { NEXT_RUNTIME: "nodejs", NEXT_PHASE: "", VITEST: "", NODE_ENV: "test", JOBS_ENABLED: "true" },
  ]) {
    for (const [key, value] of Object.entries(patch)) vi.stubEnv(key, value)
    await register()
  }
  expect(startScheduler).not.toHaveBeenCalled()
  vi.stubEnv("NEXT_RUNTIME", "nodejs")
  vi.stubEnv("NODE_ENV", "production")
  await register()
  expect(startScheduler).toHaveBeenCalledOnce()
})
