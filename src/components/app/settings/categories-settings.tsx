"use client"

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { createCategoryAction, deleteCategoryAction, setCategoryArchivedAction, updateCategoryAction } from "@/app/actions/catalog"
import { CATEGORY_ICONS, CategoryIcon } from "@/components/app/category-icon"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CATEGORY_COLORS } from "@/domain/defaults"
import { useAction } from "@/hooks/use-action"
import { cn } from "@/lib/utils"
import { Section } from "./section"

interface Category {
  id: string
  kind: "income" | "expense"
  name: string
  icon: string
  color: string
  archived: boolean
}

type Editing = { mode: "new"; kind: "income" | "expense" } | { mode: "edit"; category: Category }

export function CategoriesSettings({ categories, canManage }: { categories: Category[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Editing | null>(null)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["expense", "income"] as const).map((kind) => (
        <Section
          key={kind}
          title={kind === "expense" ? "Категории расходов" : "Категории доходов"}
          description={canManage ? "Удалить можно только неиспользуемую категорию; иначе — архивируйте, история сохранится." : undefined}
          action={
            canManage ? (
              <Button size="sm" variant="outline" onClick={() => setEditing({ mode: "new", kind })}>
                <Plus /> Добавить
              </Button>
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

function CategoryRow({ category: c, canManage, onEdit }: { category: Category; canManage: boolean; onEdit: () => void }) {
  const { run } = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <li className={cn("flex items-center gap-3 py-2", c.archived && "opacity-60")}>
      <CategoryIcon icon={c.icon} color={c.color} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {c.name} {c.archived ? <span className="text-xs text-muted-foreground">· в архиве</span> : null}
      </span>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Действия" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil /> Изменить
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => setCategoryArchivedAction(c.id, !c.archived), { success: c.archived ? "Категория восстановлена" : "Категория в архиве" })}>
              {c.archived ? <ArchiveRestore /> : <Archive />} {c.archived ? "Восстановить" : "В архив"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Удалить категорию «${c.name}»?`}
        description="Если категория уже используется в операциях, удаление будет отклонено — в этом случае отправьте её в архив."
        onConfirm={() => run(() => deleteCategoryAction(c.id), { success: "Категория удалена" })}
      />
    </li>
  )
}

function CategoryForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const initial = editing.mode === "edit" ? editing.category : null
  const [kind, setKind] = useState<"income" | "expense">(initial?.kind ?? (editing.mode === "new" ? editing.kind : "expense"))
  const [name, setName] = useState(initial?.name ?? "")
  const [icon, setIcon] = useState(initial?.icon ?? "circle")
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[0]!)
  const { pending, run } = useAction()

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (initial) run(() => updateCategoryAction(initial.id, { name, icon, color }), { success: "Категория сохранена", onSuccess: onClose })
        else run(() => createCategoryAction({ kind, name, icon, color }), { success: "Категория создана", onSuccess: onClose })
      }}
    >
      <DialogHeader>
        <DialogTitle>{initial ? "Категория" : "Новая категория"}</DialogTitle>
      </DialogHeader>
      {!initial ? (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "expense", label: "Расход" },
            { value: "income", label: "Доход" },
          ]}
        />
      ) : null}
      <div className="flex items-center gap-3">
        <CategoryIcon icon={icon} color={color} className="size-10 [&_svg]:size-5" />
        <Field className="flex-1">
          <FieldLabel htmlFor="cat-name">Название</FieldLabel>
          <Input id="cat-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel>Цвет</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Цвет ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition", color === c && "ring-2 ring-foreground")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>
      <Field>
        <FieldLabel>Иконка</FieldLabel>
        <div className="grid grid-cols-8 gap-1.5">
          {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              aria-pressed={icon === key}
              onClick={() => setIcon(key)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg border text-muted-foreground transition hover:bg-accent",
                icon === key && "border-primary bg-primary/10 text-primary",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  )
}
