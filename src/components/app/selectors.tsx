import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { currencyOptions, getCurrency } from "@/domain/presets"
import type { Category } from "@/domain/types"

export function CurrencySelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const selected = getCurrency(value)

  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className="w-full">
        <SelectValue>
          <span className="truncate">
            {selected.region} {selected.code} {selected.symbol} {selected.name}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[calc(100vw-2rem)]">
        <SelectGroup>
          {currencyOptions.map((currency) => (
            <SelectItem key={currency.code} value={currency.code}>
              <span className="truncate">
                {currency.region} {currency.code} {currency.symbol}{" "}
                {currency.name}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: Category[]
  value: string
  onChange: (value: string) => void
}) {
  const selected = categories.find((category) => category.id === value)

  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className="w-full">
        <SelectValue>
          <span className="truncate">
            {selected
              ? `${selected.icon} ${selected.name}`
              : "Выберите категорию"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[calc(100vw-2rem)]">
        <SelectGroup>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              <span className="truncate">
                {category.icon} {category.name}
              </span>
            </SelectItem>
          ))}
          <SelectItem value="__new__">＋ Создать категорию</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
