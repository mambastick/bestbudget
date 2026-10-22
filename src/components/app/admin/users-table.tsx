"use client"

import { Ban, Copy, KeyRound, LogOut, MoreHorizontal, ShieldCheck, ShieldOff, UserCheck } from "lucide-react"
import { useState } from "react"
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
  const [password, setPassword] = useState<string | null>(null)
  return (
    <Section title="Пользователи" description={`Всего: ${users.length}. Новые пользователи появляются по приглашениям, через SSO или публичную регистрацию.`}>
      <ul className="divide-y">
        {users.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} onPassword={setPassword} />
        ))}
      </ul>
      <Dialog open={password !== null} onOpenChange={(o) => !o && setPassword(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Временный пароль</DialogTitle>
            <DialogDescription>Передайте его пользователю безопасным способом и попросите сменить пароль после входа. Показывается один раз.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={password ?? ""} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Скопировать"
              onClick={async () => {
                await navigator.clipboard.writeText(password ?? "").catch(() => {})
                toast.success("Скопировано")
              }}
            >
              <Copy />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPassword(null)}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function UserRow({ user: u, isSelf, onPassword }: { user: AdminUser; isSelf: boolean; onPassword: (p: string) => void }) {
  const { run } = useAction()
  const [confirm, setConfirm] = useState<"ban" | "reset" | null>(null)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {u.name}
          {isSelf ? <span className="text-muted-foreground">(вы)</span> : null}
          {u.role === "admin" ? <Badge>администратор</Badge> : null}
          {u.banned ? <Badge variant="destructive">заблокирован</Badge> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {u.email} · вход: {u.providers.map((p) => (p === "credential" ? "пароль" : p === "oidc" ? "SSO" : p)).join(", ") || "—"} · пространств: {u.households}
          {u.lastSeen ? ` · активность ${formatDateTime(u.lastSeen, tz)}` : ""}
        </div>
      </div>
      {!isSelf ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Действия" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={() => run(() => setUserRoleAction(u.id, u.role === "admin" ? "user" : "admin"), { success: "Роль изменена" })}>
              {u.role === "admin" ? <ShieldOff /> : <ShieldCheck />}
              {u.role === "admin" ? "Снять права администратора" : "Сделать администратором"}
            </DropdownMenuItem>
            {u.providers.includes("credential") ? (
              <DropdownMenuItem onClick={() => setConfirm("reset")}>
                <KeyRound /> Сбросить пароль
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => run(() => revokeUserSessionsAction(u.id), { success: "Сеансы завершены" })}>
              <LogOut /> Завершить все сеансы
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {u.banned ? (
              <DropdownMenuItem onClick={() => run(() => setUserBannedAction(u.id, false), { success: "Пользователь разблокирован" })}>
                <UserCheck /> Разблокировать
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => setConfirm("ban")}>
                <Ban /> Заблокировать
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDialog
        open={confirm === "ban"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Заблокировать ${u.name}?`}
        description="Пользователь не сможет войти, активные сеансы будут завершены. Данные сохранятся."
        confirmLabel="Заблокировать"
        onConfirm={() => run(() => setUserBannedAction(u.id, true), { success: "Пользователь заблокирован" })}
      />
      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Сбросить пароль ${u.name}?`}
        description="Будет создан временный пароль, все сеансы пользователя завершатся."
        confirmLabel="Сбросить"
        onConfirm={() => run(() => resetUserPasswordAction(u.id), { onSuccess: (d) => onPassword(d.password) })}
      />
    </li>
  )
}
