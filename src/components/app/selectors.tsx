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
          {selected.region} {selected.code} {selected.symbol} {selected.name}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          {currencyOptions.map((currency) => (
            <SelectItem key={currency.code} value={currency.code}>
              {currency.region} {currency.code} {currency.symbol}{" "}
              {currency.name}
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
          {selected ? `${selected.icon} ${selected.name}` : "Выберите категорию"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectGroup>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.icon} {category.name}
            </SelectItem>
          ))}
          <SelectItem value="__new__">＋ Создать категорию</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
