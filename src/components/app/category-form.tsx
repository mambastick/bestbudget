"use client"

import { useTranslations } from "next-intl"
import { useState } from "react"
import { createCategoryAction, updateCategoryAction } from "@/app/actions/catalog"
import { CATEGORY_ICONS, CategoryIcon } from "@/components/app/category-icon"
import { Segmented } from "@/components/app/segmented"
import type { CatalogCategory } from "@/components/app/operations/catalog-context"
import { Button } from "@/components/ui/button"
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CATEGORY_COLORS } from "@/domain/defaults"
import { useAction } from "@/hooks/use-action"
import { cn } from "@/lib/utils"

export type CategoryEditing = { mode: "new"; kind: "income" | "expense" } | { mode: "edit"; category: CatalogCategory }

export function CategoryForm({ editing, onClose, kindLocked = false, onCreated }: {
  editing: CategoryEditing
  onClose: () => void
  kindLocked?: boolean
  onCreated?: (category: CatalogCategory) => void
}) {
  const t = useTranslations("settings")
  const initial = editing.mode === "edit" ? editing.category : null
  const [kind, setKind] = useState<"income" | "expense">(initial?.kind ?? (editing.mode === "new" ? editing.kind : "expense"))
  const [name, setName] = useState(initial?.name ?? "")
  const [icon, setIcon] = useState(initial?.icon ?? "circle")
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[0]!)
  const { pending, run } = useAction()
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="grid grid-cols-1 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        if (initial) run(() => updateCategoryAction(initial.id, { name, icon, color }), { success: t("categories.categorySaved"), onSuccess: onClose, onError: setError })
        else run(() => createCategoryAction({ kind, name, icon, color }), {
          success: t("categories.categoryCreated"),
          onSuccess: ({ id }) => {
            onCreated?.({ id, kind, name: name.trim(), icon, color, archived: false })
            onClose()
          },
          onError: setError,
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{initial ? t("categories.category") : t("categories.newCategory")}</DialogTitle>
      </DialogHeader>
      {!initial && !kindLocked ? (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "expense", label: t("categories.expense") },
            { value: "income", label: t("categories.income") },
          ]}
        />
      ) : null}
      <div className="flex items-center gap-3">
        <CategoryIcon icon={icon} color={color} className="size-10 [&_svg]:size-5" />
        <Field className="flex-1">
          <FieldLabel htmlFor="cat-name">{t("categories.name")}</FieldLabel>
          <Input id="cat-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field>
        <FieldLabel>{t("categories.color")}</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={t("categories.colorValue", { c })}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition", color === c && "ring-2 ring-foreground")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>
      <Field>
        <FieldLabel>{t("categories.icon")}</FieldLabel>
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
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("categories.cancel")}{" "}</Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {t("categories.save")}{" "}</Button>
      </DialogFooter>
    </form>
  )
}
