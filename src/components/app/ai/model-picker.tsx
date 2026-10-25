"use client"

import { Combobox } from "@base-ui/react/combobox"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ModelPicker({ models, onChange, disabled }: { models: string[]; onChange: (value: string) => void; disabled?: boolean }) {
  const t = useTranslations("ai.admin")
  return (
    <Combobox.Root<string> disabled={disabled} items={models} onValueChange={(value) => value && onChange(value)}>
      <Combobox.Trigger aria-label={t("chooseModel", { count: models.length })} render={<Button variant="outline" className="w-full min-w-0" />}>
        {t("chooseModel", { count: models.length })}
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50 w-(--anchor-width) max-w-[calc(100vw-2rem)]">
          <Combobox.Popup className="rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
            <Combobox.Input render={<Input aria-label={t("searchModels")} placeholder={t("searchModels")} />} />
            <Combobox.Empty className="p-2 text-sm text-muted-foreground">{t("noModels")}</Combobox.Empty>
            <Combobox.List className="mt-2 max-h-64 overflow-y-auto">
              {(model: string) => (
                <Combobox.Item key={model} value={model} className="cursor-default rounded-md px-2 py-1.5 text-sm wrap-anywhere data-highlighted:bg-accent">
                  {model}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
