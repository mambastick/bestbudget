"use client"

import { useLocale, useTranslations } from "next-intl"

import { CurrencySelect } from "@/components/app/currency-select"
import type { Currency } from "@/lib/currencies"

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
import { can, type HouseholdRole } from "@/domain/permissions"
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
  household: { name: string; timezone: string; currency: string; version: number }
  members: Member[]
  invitations: Invitation[]
  currentUserId: string
  role: HouseholdRole
}) {
  const locale = useLocale()
  const roles = useTranslations("common.roles")
  const t = useTranslations("settings")
  const router = useRouter()
  const { pending, run } = useAction()
  const [name, setName] = useState(household.name)
  const [currency, setCurrency] = useState<Currency>(household.currency as Currency)
  const [timezone, setTimezone] = useState(household.timezone)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const isOwner = can(role, "household.manage")

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title={t("household.household")} description={t("household.currency", { currency: household.currency })}>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => updateHouseholdAction({ name, timezone, currency, version: household.version }), { success: t("household.settingsSaved") })
          }}
        >
          <Field>
            <FieldLabel htmlFor="hh-name">{t("household.name")}</FieldLabel>
            <Input id="hh-name" value={name} maxLength={80} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hh-tz">{t("household.timeZone")}</FieldLabel>
            {isOwner ? <TimezoneSelect id="hh-tz" value={timezone} onChange={setTimezone} /> : <Input id="hh-tz" value={timezone} disabled />}
            <p className="text-xs text-muted-foreground">{t("household.determinesTodayForPlannedTransactionsAndForecasts")}</p>
          </Field>
          <Field>
            <FieldLabel htmlFor="hh-currency">{t("household.baseCurrency")}</FieldLabel>
            <CurrencySelect id="hh-currency" value={currency} onChange={setCurrency} disabled={!isOwner} />
            <p className="text-xs text-muted-foreground">{t("household.changingTheBaseCurrencyKeepsBudgetLimitsIn")}</p>
          </Field>
          {isOwner ? (
            <Button type="submit" className="justify-self-start" disabled={pending || (name === household.name && timezone === household.timezone && currency === household.currency)}>
              {t("household.save")}{" "}</Button>
          ) : null}
        </form>
      </Section>

      <Section
        title={t("household.members")}
        description={t("household.allMembersCanViewAndEditTheShared")}
        action={
          can(role, "invitations.manage") ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Link2 /> {t("household.invite")}{" "}</Button>
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
            <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("household.activeInvitations")}</div>
            <ul className="divide-y">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                  <Link2 className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {i.note || t("household.invitation")} · {roles(i.role)}
                    <span className="block text-xs text-muted-foreground">{t("household.until")}{" "}{formatDateTime(i.expiresAt, household.timezone, locale)}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => run(() => revokeInvitationAction(i.id), { success: t("household.invitationRevoked") })}>
                    {t("household.revoke")}{" "}</Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title={t("household.dangerZone")}>
        <div className="flex flex-wrap gap-2">
          {role !== "owner" ? (
            <Button variant="outline" onClick={() => setLeaveOpen(true)}>
              <LogOut /> {t("household.leaveHousehold")}{" "}</Button>
          ) : null}
          {isOwner ? (
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 /> {t("household.deleteHousehold")}{" "}</Button>
          ) : null}
        </div>
      </Section>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} canInviteAdmin={can(role, "invitations.manage")} />
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t("household.leaveThisHousehold")}
        description={t("household.youLlLoseAccessToItsDataYou")}
        confirmLabel={t("household.leave")}
        onConfirm={() => run(() => leaveHouseholdAction(), { onSuccess: () => router.replace("/dashboard") })}
      />
      <DeleteHouseholdDialog open={deleteOpen} onOpenChange={setDeleteOpen} name={household.name} />
    </div>
  )
}

function MemberRow({ member: m, isSelf, canManage }: { member: Member; isSelf: boolean; canManage: boolean }) {
  const roles = useTranslations("common.roles")
  const t = useTranslations("settings")
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
          {m.name} {isSelf ? <span className="text-muted-foreground">{t("household.you")}</span> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
      </div>
      <Badge variant={m.role === "owner" ? "default" : "secondary"}>{roles(m.role)}</Badge>
      {canManage && !isSelf && m.role !== "owner" ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("household.actions")} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => run(() => changeMemberRoleAction(m.userId, m.role === "admin" ? "member" : "admin"), { success: t("household.roleUpdated") })}>
              {m.role === "admin" ? t("household.makeMember") : t("household.makeAdministrator")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirm("owner")}>
              <Crown /> {t("household.transferOwnership")}{" "}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm("remove")}>
              <UserMinus /> {t("household.remove")}{" "}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("household.removeTitle", { name: m.name })}
        description={t("household.thisMemberWillImmediatelyLoseAccessTheirTransactions")}
        confirmLabel={t("household.remove")}
        onConfirm={() => run(() => removeMemberAction(m.userId), { success: t("household.memberRemoved") })}
      />
      <ConfirmDialog
        open={confirm === "owner"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("household.transferOwnershipTo", { name: m.name })}
        description={t("household.theNewOwnerWillHaveFullControlOf")}
        confirmLabel={t("household.transfer")}
        destructive={false}
        onConfirm={() => run(() => transferOwnershipAction(m.userId), { success: t("household.ownershipTransferred") })}
      />
    </li>
  )
}

function InviteDialog({ open, onOpenChange, canInviteAdmin }: { open: boolean; onOpenChange: (o: boolean) => void; canInviteAdmin: boolean }) {
  const t = useTranslations("settings")
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
          <DialogTitle>{t("household.inviteToHousehold")}</DialogTitle>
          <DialogDescription>{t("household.thisSingleUseLinkExpiresInDaysShare")}</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid grid-cols-1 gap-3">
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("household.invitationLink")} />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("household.copy")}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link)
                    toast.success(t("household.linkCopied"))
                  } catch {
                    toast.error(t("household.copyTheLinkManually"))
                  }
                }}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("household.thisLinkIsShownOnlyOnceSaveIt")}</p>
            <DialogFooter>
              <Button onClick={() => close(false)}>{t("household.done")}</Button>
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
              <FieldLabel htmlFor="inv-note">{t("household.recipientOptional")}</FieldLabel>
              <Input id="inv-note" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder={t("household.forExampleForAnna")} />
            </Field>
            <Field>
              <FieldLabel>{t("household.role")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => v && setRole(v as "member" | "admin")}
                items={[
                  { value: "member", label: t("household.memberTransactions") },
                  ...(canInviteAdmin ? [{ value: "admin", label: t("household.administratorAlsoCategoriesAccountsAndInvitations") }] : []),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t("household.memberTransactions")}</SelectItem>
                  {canInviteAdmin ? <SelectItem value="admin">{t("household.administratorAlsoCategoriesAccountsAndInvitations")}</SelectItem> : null}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t("household.cancel")}{" "}</Button>
              <Button type="submit" disabled={pending}>
                {t("household.createLink")}{" "}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeleteHouseholdDialog({ open, onOpenChange, name }: { open: boolean; onOpenChange: (o: boolean) => void; name: string }) {
  const t = useTranslations("settings")
  const router = useRouter()
  const [confirm, setConfirm] = useState("")
  const { pending, run } = useAction()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("household.deleteTitle", { name })}</DialogTitle>
          <DialogDescription>{t("household.allAccountsTransactionsRecurringRulesBudgetsAndMemberships")}</DialogDescription>
        </DialogHeader>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={name} aria-label={t("household.householdName")} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("household.cancel")}{" "}</Button>
          <Button
            variant="destructive"
            disabled={pending || confirm.trim() !== name.trim()}
            onClick={() => run(() => deleteHouseholdAction(confirm), { success: t("household.householdDeleted"), onSuccess: () => router.replace("/dashboard") })}
          >
            {t("household.deletePermanently")}{" "}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
