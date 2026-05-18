import {
  BanknoteIcon,
  BellIcon,
  ChevronDownIcon,
  LogOutIcon,
  PiggyBankIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UserPlusIcon,
} from "lucide-react"
import { type ReactNode } from "react"

import { navItems } from "@/components/app/nav"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { getInitials } from "@/domain/format"
import type { User, View, Workspace } from "@/domain/types"

export function AppShell({
  user,
  workspaces,
  activeWorkspace,
  activeView,
  searchQuery,
  children,
  onNavigate,
  onSearchChange,
  onWorkspaceChange,
  onCreateWorkspace,
  onOpenDialog,
  onOpenNotifications,
  onLogout,
}: {
  user: User
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  activeView: View
  searchQuery: string
  children: ReactNode
  onNavigate: (view: View) => void
  onSearchChange: (value: string) => void
  onWorkspaceChange: (workspaceId: string) => void
  onCreateWorkspace: () => void
  onOpenDialog: (dialog: "transaction" | "budget" | "invite") => void
  onOpenNotifications: () => void
  onLogout: () => void
}) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <BanknoteIcon />
                  </div>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">BestBudget</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {activeWorkspace?.name ?? "Пространство не настроено"}
                    </span>
                  </div>
                  <ChevronDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Пространства</DropdownMenuLabel>
                    {workspaces.map((workspace) => (
                      <DropdownMenuItem
                        key={workspace.id}
                        onClick={() => onWorkspaceChange(workspace.id)}
                      >
                        <BanknoteIcon />
                        <span className="truncate">{workspace.name}</span>
                        {workspace.id === activeWorkspace?.id ? (
                          <Badge variant="outline" className="ml-auto">
                            active
                          </Badge>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    {workspaces.length ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem onClick={onCreateWorkspace}>
                      <PlusIcon />
                      Создать пространство
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Навигация</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.view}>
                    <SidebarMenuButton
                      isActive={activeView === item.view}
                      tooltip={item.label}
                      onClick={() => onNavigate(item.view)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                  <Avatar className="size-8">
                    <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" side="top" align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Аккаунт</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onNavigate("settings")}>
                      <SettingsIcon />
                      Настройки аккаунта
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onLogout}>
                    <LogOutIcon />
                    Выйти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 max-w-xl pl-8"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Поиск операций, бюджетов, документов"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Уведомления"
            onClick={onOpenNotifications}
          >
            <BellIcon />
          </Button>
          <Button
            variant="outline"
            className="hidden sm:inline-flex"
            onClick={() => onOpenDialog("invite")}
          >
            <UserPlusIcon data-icon="inline-start" />
            Пригласить
          </Button>
          <Button
            variant="outline"
            className="hidden md:inline-flex"
            onClick={() => onOpenDialog("budget")}
          >
            <PiggyBankIcon data-icon="inline-start" />
            Бюджет
          </Button>
          <Button onClick={() => onOpenDialog("transaction")}>
            <PlusIcon data-icon="inline-start" />
            Операция
          </Button>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
