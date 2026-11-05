"use client"

import { useTranslations } from "next-intl"

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { deleteCategoryAction, setCategoryArchivedAction } from "@/app/actions/catalog"
import { CategoryIcon } from "@/components/app/category-icon"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { CategoryForm, type CategoryEditing } from "@/components/app/category-form"
import type { CatalogCategory } from "@/components/app/operations/catalog-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAction } from "@/hooks/use-action"
import { cn } from "@/lib/utils"
import { Section } from "./section"

export function CategoriesSettings({ categories, canManage }: { categories: CatalogCategory[]; canManage: boolean }) {
  const t = useTranslations("settings")
  const [editing, setEditing] = useState<CategoryEditing | null>(null)
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {(["expense", "income"] as const).map((kind) => (
        <Section
          key={kind}
          title={kind === "expense" ? t("categories.expenseCategories") : t("categories.incomeCategories")}
          description={canManage ? t("categories.onlyUnusedCategoriesCanBeDeletedArchiveCategories") : undefined}
          action={
            canManage ? (
              <Button size="sm" variant="outline" onClick={() => setEditing({ mode: "new", kind })}>
                <Plus /> {t("categories.add")}{" "}</Button>
            ) : null
          }
        >
          <ul className="divide-y">
            {categories
              .filter((c) => c.kind === kind)
              .sort((a, b) => Number(a.archived) - Number(b.archived))
              .map((c) => (
                <CategoryRow key={c.id} category={c} canManage={canManage} onEdit={() => setEditing({ mode: "edit", category: c })} />
              ))}
          </ul>
        </Section>
      ))}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing ? <CategoryForm key={editing.mode === "edit" ? editing.category.id : editing.kind} editing={editing} onClose={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CategoryRow({ category: c, canManage, onEdit }: { category: CatalogCategory; canManage: boolean; onEdit: () => void }) {
  const t = useTranslations("settings")
  const { run } = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <li className={cn("flex items-center gap-3 py-2", c.archived && "opacity-60")}>
      <CategoryIcon icon={c.icon} color={c.color} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {c.name} {c.archived ? <span className="text-xs text-muted-foreground">{t("categories.archived")}</span> : null}
      </span>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("categories.actions")} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil /> {t("categories.edit")}{" "}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => setCategoryArchivedAction(c.id, !c.archived), { success: c.archived ? t("categories.categoryRestored") : t("categories.categoryArchived") })}>
              {c.archived ? <ArchiveRestore /> : <Archive />} {c.archived ? t("categories.restore") : t("categories.archive")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> {t("categories.delete")}{" "}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("categories.deleteCategory", { name: c.name })}
        description={t("categories.categoriesUsedInTransactionsCannotBeDeletedArchive")}
        onConfirm={() => run(() => deleteCategoryAction(c.id), { success: t("categories.categoryDeleted") })}
      />
    </li>
  )
}
