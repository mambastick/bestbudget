"use client"

import { useTranslations } from "next-intl"

import { useTransition } from "react"
import { toast } from "sonner"
import type { ActionResult } from "@/server/errors"

/**
 * Runs a server action with pending state and toast feedback.
 * Actions revalidate the page themselves, so fresh data arrives with the action response.
 */
export function useAction() {
  const t = useTranslations("common")
  const [pending, startTransition] = useTransition()

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    opts: { success?: string; onSuccess?: (data: T) => void; onError?: (error: string, fieldErrors?: Record<string, string>) => void } = {},
  ) {
    startTransition(async () => {
      let res: ActionResult<T>
      try {
        res = await action()
      } catch {
        toast.error(t("useAction.canTReachTheServerCheckYourConnection"))
        return
      }
      if (!res.ok) {
        toast.error(res.error)
        opts.onError?.(res.error, res.fieldErrors)
        return
      }
      if (opts.success) toast.success(opts.success)
      opts.onSuccess?.(res.data)
    })
  }

  return { pending, run }
}
