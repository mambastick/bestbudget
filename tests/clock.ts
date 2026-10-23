export const testNow = new Date(process.env.TEST_NOW ?? "2026-10-23T09:00:00Z")
if (Number.isNaN(testNow.getTime())) throw new Error("TEST_NOW must be an ISO timestamp")
