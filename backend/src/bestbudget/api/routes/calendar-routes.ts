import type { FastifyInstance } from "fastify"

import {
  calendarDayQuerySchema,
  calendarDayResponseSchema,
} from "../schemas/calendar"
import { getCalendarDay, getCalendarMonth } from "../../application/calendar/calendar-service"

export async function registerCalendarRoutes(app: FastifyInstance) {
  app.get("/api/calendar", async (request, reply) => {
    const query = request.query as {
      householdId?: string
      month?: string
    }

    if (!query.householdId || !query.month) {
      return reply.code(400).send({
        error: "invalid_calendar_query",
        message: "householdId and month are required",
      })
    }

    return getCalendarMonth(query.householdId, query.month)
  })

  app.get("/api/calendar/day", async (request, reply) => {
    const parsed = calendarDayQuerySchema.safeParse(request.query)

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_calendar_day_query",
        issues: parsed.error.issues,
      })
    }

    const response = getCalendarDay(parsed.data)
    return calendarDayResponseSchema.parse(response)
  })
}
