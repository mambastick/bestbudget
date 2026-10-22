import { expect, it } from "vitest"
import { plural } from "./plural"

it.each([
  [0, "счетов"], [1, "счёт"], [2, "счёта"], [4, "счёта"], [5, "счетов"],
  [11, "счетов"], [12, "счетов"], [14, "счетов"], [21, "счёт"], [22, "счёта"],
  [101, "счёт"], [111, "счетов"], [-2, "счёта"], [1.5, "счетов"],
])("declines %s Russian accounts", (count, expected) => {
  expect(plural(count as number, "счёт", "счёта", "счетов")).toBe(expected)
})
