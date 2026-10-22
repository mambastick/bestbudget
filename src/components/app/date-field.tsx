"use client"

import { CalendarIcon } from "lucide-react"
import { useState } from "react"
import { ru } from "react-day-picker/locale"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { addDays, formatDateFull, type IsoDate } from "@/lib/dates"
import { cn } from "@/lib/utils"

function toDate(iso: IsoDate) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y!, m! - 1, d!)
}

function toIso(date: Date): IsoDate {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Date picker with quick choices. `today` comes from the server (household time zone). */
export function DateField({
  value,
  onChange,
  today,
  placeholder = "Выберите дату",
  quick = true,
  clearable,
  id,
  className,
}: {
  value: IsoDate | null
  onChange: (value: IsoDate | null) => void
  today: IsoDate
  placeholder?: string
  quick?: boolean
  clearable?: boolean
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const pick = (d: IsoDate | null) => {
    onChange(d)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button id={id} type="button" variant="outline" className={cn("w-full justify-start font-normal", !value && "text-muted-foreground", className)} />
        }
      >
        <CalendarIcon className="text-muted-foreground" />
        {value ? formatDateFull(value) : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {quick ? (
          <div className="flex flex-wrap gap-1 border-b p-2">
            <Button type="button" size="xs" variant="secondary" onClick={() => pick(addDays(today, -1))}>
              Вчера
            </Button>
            <Button type="button" size="xs" variant="secondary" onClick={() => pick(today)}>
              Сегодня
            </Button>
            <Button type="button" size="xs" variant="secondary" onClick={() => pick(addDays(today, 1))}>
              Завтра
            </Button>
            {clearable && value ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => pick(null)}>
                Очистить
              </Button>
            ) : null}
          </div>
        ) : null}
        <Calendar
          mode="single"
          locale={ru}
          weekStartsOn={1}
          selected={value ? toDate(value) : undefined}
          defaultMonth={toDate(value ?? today)}
          onSelect={(d) => d && pick(toIso(d))}
          captionLayout="dropdown"
          startMonth={new Date(2000, 0)}
          endMonth={new Date(2100, 11)}
        />
      </PopoverContent>
    </Popover>
  )
}
