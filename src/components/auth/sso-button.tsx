"use client"

import { KeyRound } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { authClient, authErrorMessage } from "@/lib/auth-client"

export function SsoButton({ name, callbackURL = "/dashboard", before }: { name: string; callbackURL?: string; before?: () => Promise<boolean> }) {
  const [pending, setPending] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        if (before && !(await before())) return setPending(false)
        const { error } = await authClient.signIn.social({ provider: "oidc", callbackURL, errorCallbackURL: "/login" })
        if (error) {
          toast.error(authErrorMessage(error))
          setPending(false)
        }
      }}
    >
      <KeyRound /> {pending ? "Перенаправление…" : `Войти через ${name}`}
    </Button>
  )
}
