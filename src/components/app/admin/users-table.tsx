"use client"

import { Ban, Copy, KeyRound, LogOut, MoreHorizontal, ShieldCheck, ShieldOff, UserCheck } from "lucide-react"
import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { resetUserPasswordAction, revokeUserSessionsAction, setUserBannedAction, setUserRoleAction } from "@/app/actions/admin"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Section } from "@/components/app/settings/section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import { formatDateTime } from "@/lib/dates"

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  createdAt: string
  providers: string[]
  households: number
  lastSeen: string | null
}

export function UsersTable({ users, currentUserId }: { users: AdminUser[]; currentUserId: string }) {
  const t = useTranslations("admin")
  const [password, setPassword] = useState<string | null>(null)
  return (
    <Section title={t("users")} description={t("userCount", { count: users.length })}>
      <ul className="divide-y">
        {users.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} onPassword={setPassword} />
        ))}
      </ul>
      <Dialog open={password !== null} onOpenChange={(o) => !o && setPassword(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("temporaryPassword")}</DialogTitle>
            <DialogDescription>{t("temporaryPasswordHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={password ?? ""} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              size="icon"
              aria-label={t("copy")}
              onClick={async () => {
                await navigator.clipboard.writeText(password ?? "").catch(() => {})
                toast.success(t("copied"))
              }}
            >
              <Copy />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPassword(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function UserRow({ user: u, isSelf, onPassword }: { user: AdminUser; isSelf: boolean; onPassword: (p: string) => void }) {
  const t = useTranslations("admin")
  const locale = useLocale()
  const { run } = useAction()
  const [confirm, setConfirm] = useState<"ban" | "reset" | null>(null)
  const tz = Intl.DateTimeFormat(locale).resolvedOptions().timeZone
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {u.name}
          {isSelf ? <span className="text-muted-foreground">{t("self")}</span> : null}
          {u.role === "admin" ? <Badge>{t("administrator")}</Badge> : null}
          {u.banned ? <Badge variant="destructive">{t("blocked")}</Badge> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {t("userDetails", { email: u.email, providers: u.providers.map((p) => (p === "credential" ? t("password") : p === "oidc" ? "SSO" : p)).join(", ") || "—", count: u.households })}
          {u.lastSeen ? ` · ${t("lastSeen", { date: formatDateTime(u.lastSeen, tz, locale) })}` : ""}
        </div>
      </div>
      {!isSelf ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions")} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={() => run(() => setUserRoleAction(u.id, u.role === "admin" ? "user" : "admin"), { success: t("roleChanged") })}>
              {u.role === "admin" ? <ShieldOff /> : <ShieldCheck />}
              {u.role === "admin" ? t("removeAdmin") : t("makeAdmin")}
            </DropdownMenuItem>
            {u.providers.includes("credential") ? (
              <DropdownMenuItem onClick={() => setConfirm("reset")}>
                <KeyRound /> {t("resetPassword")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => run(() => revokeUserSessionsAction(u.id), { success: t("sessionsEnded") })}>
              <LogOut /> {t("revokeSessions")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {u.banned ? (
              <DropdownMenuItem onClick={() => run(() => setUserBannedAction(u.id, false), { success: t("userUnbanned") })}>
                <UserCheck /> {t("unblock")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm("ban")}>
                <Ban /> {t("block")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDialog
        open={confirm === "ban"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("blockTitle", { name: u.name })}
        description={t("blockHint")}
        confirmLabel={t("block")}
        onConfirm={() => run(() => setUserBannedAction(u.id, true), { success: t("userBanned") })}
      />
      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("resetTitle", { name: u.name })}
        description={t("resetHint")}
        confirmLabel={t("reset")}
        onConfirm={() => run(() => resetUserPasswordAction(u.id), { onSuccess: (d) => onPassword(d.password) })}
      />
    </li>
  )
}
