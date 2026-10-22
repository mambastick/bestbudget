"use client"

import { AnimateIcon } from "@animate-ui/react/icons"
import { Check, ChevronsUpDown, PiggyBank, Plus } from "lucide-react"
import { CalendarDays } from "@/components/animate-ui/icons/calendar-days"
import { ChartLine } from "@/components/animate-ui/icons/chart-line"
import { Gauge } from "@/components/animate-ui/icons/gauge"
import { LayoutDashboard } from "@/components/animate-ui/icons/layout-dashboard"
import { List } from "@/components/animate-ui/icons/list"
import { LogOut } from "@/components/animate-ui/icons/log-out"
import { Moon } from "@/components/animate-ui/icons/moon"
import { Plus as AnimatedPlus } from "@/components/animate-ui/icons/plus"
import { Settings } from "@/components/animate-ui/icons/settings"
import { ShieldCheck } from "@/components/animate-ui/icons/shield-check"
import { Sun } from "@/components/animate-ui/icons/sun"
import { Wallet } from "@/components/animate-ui/icons/wallet"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect } from "react"
import { switchHouseholdAction } from "@/app/actions/household"
import { useOperations } from "@/components/app/operations/operations-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { ROLE_LABELS, type HouseholdRole } from "@/domain/permissions"
import { useAction } from "@/hooks/use-action"
import { authClient } from "@/lib/auth-client"
import { APP_VERSION, IS_PRERELEASE } from "@/lib/version"

const NAV = [
  { href: "/dashboard", label: "Обзор", icon: LayoutDashboard },
  { href: "/transactions", label: "Операции", icon: List },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  { href: "/budgets", label: "Бюджеты", icon: Gauge },
  { href: "/analytics", label: "Аналитика", icon: ChartLine },
  { href: "/accounts", label: "Счета", icon: Wallet },
  { href: "/settings", label: "Настройки", icon: Settings },
]

export interface ShellProps {
  user: { name: string; email: string; isAdmin: boolean }
  households: { id: string; name: string; role: HouseholdRole }[]
  activeHouseholdId: string
  children: React.ReactNode
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
}

export function AppShell({ user, households, activeHouseholdId, children }: ShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar user={user} households={households} activeHouseholdId={activeHouseholdId} />
      <SidebarInset className="min-w-0">
        <Header title={households.find((h) => h.id === activeHouseholdId)?.name ?? "BestBudget"} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 md:pb-10">{children}</main>
      </SidebarInset>
      <RefreshOnFocus />
    </SidebarProvider>
  )
}

function AppSidebar({ user, households, activeHouseholdId }: Omit<ShellProps, "children">) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const active = households.find((h) => h.id === activeHouseholdId)
  const { run } = useAction()
  const router = useRouter()

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <PiggyBank className="size-4" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{active?.name ?? "BestBudget"}</span>
                  <span className="truncate text-xs text-muted-foreground">{active ? ROLE_LABELS[active.role] : ""}</span>
                </span>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Семейные пространства</DropdownMenuLabel>
                  {households.map((h) => (
                    <DropdownMenuItem
                      key={h.id}
                      onClick={() => h.id !== activeHouseholdId && run(() => switchHouseholdAction(h.id), { onSuccess: () => router.refresh() })}
                    >
                      <span className="flex-1 truncate">{h.name}</span>
                      {h.id === activeHouseholdId ? <Check className="size-4" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/onboarding?new=1" />}>
                  <Plus /> Новое пространство
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <AnimateIcon key={item.href} animateOnHover asChild>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    tooltip={item.label}
                    render={<Link href={item.href} onClick={() => setOpenMobile(false)} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                </AnimateIcon>
              ))}
              {user.isAdmin ? (
                <AnimateIcon animateOnHover asChild>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/admin")}
                    tooltip="Администрирование"
                    render={<Link href="/admin" onClick={() => setOpenMobile(false)} />}
                  >
                    <ShieldCheck />
                    <span>Администрирование</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                </AnimateIcon>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
        <div className="px-2 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          BestBudget v{APP_VERSION}
          {IS_PRERELEASE ? <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">бета</span> : null}
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function UserMenu({ user }: { user: ShellProps["user"] }) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" side="top" align="start">
            <AnimateIcon animateOnHover asChild>
              <DropdownMenuItem render={<Link href="/settings?tab=profile" />}>
                <Settings /> Профиль и безопасность
              </DropdownMenuItem>
            </AnimateIcon>
            <AnimateIcon animateOnHover asChild>
              <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                {resolvedTheme === "dark" ? "Светлая тема" : "Тёмная тема"}
              </DropdownMenuItem>
            </AnimateIcon>
            <DropdownMenuSeparator />
            <AnimateIcon animateOnHover asChild>
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                await authClient.signOut()
                router.replace("/login")
                router.refresh()
              }}
            >
              <LogOut /> Выйти
            </DropdownMenuItem>
            </AnimateIcon>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function Header({ title }: { title: string }) {
  const ops = useOperations()

  // "N" (or "Т" on the Russian layout) opens a new operation from anywhere, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector("[role=dialog]")) return
      if (e.code === "KeyN") {
        e.preventDefault()
        ops.openCreate()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ops])
  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:rounded-t-xl">
        <SidebarTrigger className="-ml-1" />
        <span className="truncate text-sm font-medium md:hidden">{title}</span>
        <div className="flex-1" />
        <AnimateIcon animateOnHover asChild>
          <Button onClick={() => ops.openCreate()} className="hidden sm:inline-flex" aria-keyshortcuts="N">
            <AnimatedPlus /> Операция
            <kbd aria-hidden className="ml-1 hidden rounded border border-primary-foreground/30 px-1 text-[10px] font-normal opacity-80 lg:inline">N</kbd>
          </Button>
        </AnimateIcon>
      </header>
      {/* Mobile: thumb-reachable quick add. */}
      <Button
        size="icon-lg"
        onClick={() => ops.openCreate()}
        aria-label="Добавить операцию"
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg sm:hidden [&_svg]:size-6!"
      >
        <Plus />
      </Button>
    </>
  )
}

/** Shared budgets change from several devices: refetch server data when the tab regains focus. */
function RefreshOnFocus() {
  const router = useRouter()
  useEffect(() => {
    let last = Date.now()
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) {
        last = Date.now()
        router.refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [router])
  return null
}
