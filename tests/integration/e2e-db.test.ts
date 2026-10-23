import { beforeEach, describe, expect, it, vi } from "vitest"
import postgres from "postgres"
import { createE2eDb } from "../../e2e/db"

const mocks = vi.hoisted(() => ({ execute: vi.fn(), end: vi.fn() }))
vi.mock("postgres", () => ({
  default: vi.fn(() => Object.assign((...args: unknown[]) => mocks.execute(...args), { end: mocks.end })),
}))

function databaseError(code: string, message = "Synthetic protocol failure") {
  return Object.assign(new Error(message), { code })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.execute.mockReset()
  mocks.end.mockResolvedValue(undefined)
})

describe("serialized e2e SQL", () => {
  it("retries transient reads with fresh connections and preserves parameters", async () => {
    mocks.execute.mockRejectedValueOnce(databaseError("08P01"))
      .mockRejectedValueOnce(databaseError("34000", 'portal "" does not exist'))
      .mockResolvedValueOnce([{ n: 2 }])
    const db = createE2eDb()
    expect(await db`select ${42} as n`).toEqual([{ n: 2 }])
    expect(postgres).toHaveBeenCalledTimes(3)
    expect(mocks.end).toHaveBeenCalledTimes(3)
    expect(mocks.execute.mock.calls.every((args) => args[1] === 42)).toBe(true)
  })

  it("bounds retries and propagates the final error", async () => {
    const error = databaseError("08P01")
    mocks.execute.mockRejectedValue(error)
    await expect(createE2eDb()`select 1`).rejects.toBe(error)
    expect(mocks.execute).toHaveBeenCalledTimes(4)
    expect(mocks.end).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['insert into users(name) values (\'Synthetic\')', databaseError("08P01")],
    ["update users set locale = 'en'", databaseError("34000", 'portal "" does not exist')],
    ["with changed as (delete from users returning id) select * from changed", databaseError("08P01")],
    ["select 1", databaseError("23505")],
    ["select 1", new Error("Synthetic connection loss")],
  ])("never replays unsafe or unrelated failures (%s)", async (statement, error) => {
    mocks.execute.mockRejectedValue(error)
    const template = Object.assign([statement], { raw: [statement] }) as unknown as TemplateStringsArray
    await expect(createE2eDb()(template)).rejects.toBe(error)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it("serializes different facades and releases the queue after a failure", async () => {
    let rejectFirst!: (error: Error) => void
    const firstResult = new Promise((_, reject) => { rejectFirst = reject })
    mocks.execute.mockReturnValueOnce(firstResult).mockResolvedValueOnce([{ n: 2 }])
    const first = createE2eDb()`select 1`, second = createE2eDb()`select 2`
    const error = new Error("Synthetic permanent failure")
    const rejected = expect(first).rejects.toBe(error)
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1))
    rejectFirst(error)
    await rejected
    expect(await second).toEqual([{ n: 2 }])
    expect(mocks.end).toHaveBeenCalledTimes(2)
  })
})
