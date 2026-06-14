import { getMemberPermissions } from "@/domain/rbac"
import { workspacePermissions } from "@/domain/types"
import type {
  User,
  Workspace,
  WorkspaceMember,
  WorkspacePermission,
} from "@/domain/types"

export type { WorkspacePermission } from "@/domain/types"

export type WorkspacePermissions = Record<WorkspacePermission, boolean>

export const roleLabels: Record<WorkspaceMember["role"], string> = {
  owner: "Владелец",
  admin: "Админ",
  member: "Участник",
  observer: "Просмотр",
}

export const roleDescriptions: Record<WorkspaceMember["role"], string> = {
  owner: "Полный контроль бюджета, участников, SSO и финансовых настроек.",
  admin: "Управляет участниками, лимитами и рабочими финансовыми действиями.",
  member: "Добавляет операции и документы без доступа к настройкам доступа.",
  observer: "Только просматривает данные бюджета.",
}

export const permissionLabels: Record<WorkspacePermission, string> = {
  createTransactions: "Операции",
  manageBudgets: "Бюджеты",
  manageLiabilities: "Платежи",
  manageDocuments: "Документы",
  manageMembers: "Участники",
  manageSso: "SSO",
}

export const readonlyReason = "Недостаточно прав для этого действия."

export const permissionOrder: WorkspacePermission[] = [...workspacePermissions]

export const noWorkspacePermissions = createPermissionFlags([])

export function getWorkspaceMember(
  user: User | null,
  workspace: Workspace | null
) {
  if (!user || !workspace) {
    return null
  }

  return (
    workspace.members.find(
      (member) => member.userId === user.id && member.status === "active"
    ) ?? null
  )
}

export function getWorkspacePermissions(
  user: User | null,
  workspace: Workspace | null
): WorkspacePermissions {
  const member = getWorkspaceMember(user, workspace)

  if (!member) {
    return noWorkspacePermissions
  }

  return createPermissionFlags(getMemberPermissions(member))
}

function createPermissionFlags(allowedPermissions: readonly WorkspacePermission[]) {
  const allowed = new Set(allowedPermissions)

  return Object.fromEntries(
    workspacePermissions.map((permission) => [permission, allowed.has(permission)])
  ) as WorkspacePermissions
}
