"use client"

import { Copy, Crown, Link2, LogOut, MoreHorizontal, Trash2, UserMinus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import {
  changeMemberRoleAction,
  createInvitationAction,
  deleteHouseholdAction,
  leaveHouseholdAction,
  removeMemberAction,
  revokeInvitationAction,
  transferOwnershipAction,
  updateHouseholdAction,
} from "@/app/actions/household"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { TimezoneSelect } from "@/components/auth/timezone-select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { can, ROLE_LABELS, type HouseholdRole } from "@/domain/permissions"
import { useAction } from "@/hooks/use-action"
import { formatDateTime } from "@/lib/dates"
import { Section } from "./section"

interface Member {
  userId: string
  name: string
  email: string
  role: HouseholdRole
  joinedAt: string
}

interface Invitation {
  id: string
  role: HouseholdRole
  note: string | null
  expiresAt: string
  createdAt: string
}

export function HouseholdSettings({
  household,
  members,
  invitations,
  currentUserId,
  role,
}: {
  household: { name: string; timezone: string; currency: string }
  members: Member[]
  invitations: Invitation[]
  currentUserId: string
  role: HouseholdRole
}) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [name, setName] = useState(household.name)
  const [timezone, setTimezone] = useState(household.timezone)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const isOwner = can(role, "household.manage")
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title="Семейное пространство" description={`Валюта: ${household.currency}`}>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => updateHouseholdAction({ name, timezone }), { success: "Настройки сохранены" })
          }}
        >
          <Field>
            <FieldLabel htmlFor="hh-name">Название</FieldLabel>
            <Input id="hh-name" value={name} maxLength={80} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hh-tz">Часовой пояс</FieldLabel>
            {isOwner ? <TimezoneSelect id="hh-tz" value={timezone} onChange={setTimezone} /> : <Input id="hh-tz" value={timezone} disabled />}
            <p className="text-xs text-muted-foreground">Определяет «сегодня» для плановых операций и прогноза.</p>
          </Field>
          {isOwner ? (
            <Button type="submit" className="justify-self-start" disabled={pending || (name === household.name && timezone === household.timezone)}>
              Сохранить
            </Button>
          ) : null}
        </form>
      </Section>

      <Section
        title="Участники"
        description="Все участники видят и редактируют общий бюджет. Автор каждой операции сохраняется."
        action={
          can(role, "invitations.manage") ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Link2 /> Пригласить
            </Button>
          ) : null
        }
      >
        <ul className="divide-y">
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} isSelf={m.userId === currentUserId} canManage={can(role, "members.manage")} />
          ))}
        </ul>
        {invitations.length > 0 ? (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Активные приглашения</div>
            <ul className="divide-y">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                  <Link2 className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {i.note || "Приглашение"} · {ROLE_LABELS[i.role]}
                    <span className="block text-xs text-muted-foreground">до {formatDateTime(i.expiresAt, tz)}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => run(() => revokeInvitationAction(i.id), { success: "Приглашение отозвано" })}>
                    Отозвать
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Опасная зона">
        <div className="flex flex-wrap gap-2">
          {role !== "owner" ? (
            <Button variant="outline" onClick={() => setLeaveOpen(true)}>
              <LogOut /> Покинуть пространство
            </Button>
          ) : null}
          {isOwner ? (
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 /> Удалить пространство
            </Button>
          ) : null}
        </div>
      </Section>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} canInviteAdmin={can(role, "invitations.manage")} />
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Покинуть семейное пространство?"
        description="Вы потеряете доступ к его данным. Вернуться можно только по новому приглашению."
        confirmLabel="Покинуть"
        onConfirm={() => run(() => leaveHouseholdAction(), { onSuccess: () => router.replace("/dashboard") })}
      />
      <DeleteHouseholdDialog open={deleteOpen} onOpenChange={setDeleteOpen} name={household.name} />
    </div>
  )
}

function MemberRow({ member: m, isSelf, canManage }: { member: Member; isSelf: boolean; canManage: boolean }) {
  const { run } = useAction()
  const [confirm, setConfirm] = useState<"remove" | "owner" | null>(null)
  const initials = m.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Avatar className="size-8">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {m.name} {isSelf ? <span className="text-muted-foreground">(вы)</span> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
      </div>
      <Badge variant={m.role === "owner" ? "default" : "secondary"}>{ROLE_LABELS[m.role]}</Badge>
      {canManage && !isSelf && m.role !== "owner" ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Действия" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => run(() => changeMemberRoleAction(m.userId, m.role === "admin" ? "member" : "admin"), { success: "Роль изменена" })}>
              {m.role === "admin" ? "Сделать участником" : "Сделать администратором"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirm("owner")}>
              <Crown /> Передать владение
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm("remove")}>
              <UserMinus /> Исключить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Исключить ${m.name}?`}
        description="Участник сразу потеряет доступ к бюджету. Созданные им операции сохранятся."
        confirmLabel="Исключить"
        onConfirm={() => run(() => removeMemberAction(m.userId), { success: "Участник исключён" })}
      />
      <ConfirmDialog
        open={confirm === "owner"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Передать владение ${m.name}?`}
        description="Новый владелец получит полный контроль над пространством, а вы станете администратором."
        confirmLabel="Передать"
        destructive={false}
        onConfirm={() => run(() => transferOwnershipAction(m.userId), { success: "Владение передано" })}
      />
    </li>
  )
}

function InviteDialog({ open, onOpenChange, canInviteAdmin }: { open: boolean; onOpenChange: (o: boolean) => void; canInviteAdmin: boolean }) {
  const [role, setRole] = useState<"member" | "admin">("member")
  const [note, setNote] = useState("")
  const [link, setLink] = useState<string | null>(null)
  const { pending, run } = useAction()

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setLink(null)
      setNote("")
      setRole("member")
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Пригласить в семью</DialogTitle>
          <DialogDescription>Одноразовая ссылка действует 7 дней. Отправьте её супругу или супруге любым удобным способом.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid grid-cols-1 gap-3">
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка-приглашение" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Скопировать"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link)
                    toast.success("Ссылка скопирована")
                  } catch {
                    toast.error("Скопируйте ссылку вручную")
                  }
                }}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Ссылка показывается только один раз — сохранить её позже не получится.</p>
            <DialogFooter>
              <Button onClick={() => close(false)}>Готово</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid grid-cols-1 gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => createInvitationAction({ role, note: note.trim() || undefined }), { onSuccess: (d) => setLink(d.url) })
            }}
          >
            <Field>
              <FieldLabel htmlFor="inv-note">Для кого (необязательно)</FieldLabel>
              <Input id="inv-note" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder="Например, «Для Анны»" />
            </Field>
            <Field>
              <FieldLabel>Роль</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => v && setRole(v as "member" | "admin")}
                items={[
                  { value: "member", label: "Участник — операции" },
                  ...(canInviteAdmin ? [{ value: "admin", label: "Администратор — плюс категории, счета, приглашения" }] : []),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Участник — операции</SelectItem>
                  {canInviteAdmin ? <SelectItem value="admin">Администратор — плюс категории, счета, приглашения</SelectItem> : null}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                Создать ссылку
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeleteHouseholdDialog({ open, onOpenChange, name }: { open: boolean; onOpenChange: (o: boolean) => void; name: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState("")
  const { pending, run } = useAction()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить «{name}»?</DialogTitle>
          <DialogDescription>Будут безвозвратно удалены все счета, операции, расписания, бюджеты и участники. Введите название пространства для подтверждения.</DialogDescription>
        </DialogHeader>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={name} aria-label="Название пространства" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={pending || confirm.trim() !== name.trim()}
            onClick={() => run(() => deleteHouseholdAction(confirm), { success: "Пространство удалено", onSuccess: () => router.replace("/dashboard") })}
          >
            Удалить навсегда
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
