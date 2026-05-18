import { type FormEvent, useState } from "react"
import { MailIcon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CategorySelect, CurrencySelect } from "./selectors"
import { formatDateKey } from "@/domain/format"
import type {
  AccessMode,
  Budget,
  Category,
  DocumentRecord,
  Liability,
  Transaction,
} from "@/domain/types"

export type DialogName =
  | "workspace"
  | "transaction"
  | "budget"
  | "invite"
  | "liability"
  | "document"
  | null

export type WorkspaceInput = {
  name: string
  accessMode: AccessMode
  currencyCode: string
}

export type CategoryInput = {
  name: string
  kind: Category["kind"]
}

export type TransactionInput = Omit<Transaction, "id" | "workspaceId"> & {
  newCategory?: CategoryInput
}

export type BudgetInput = Omit<Budget, "id" | "workspaceId"> & {
  newCategory?: CategoryInput
}

export type InviteInput = {
  email: string
}

export type LiabilityInput = Omit<Liability, "id" | "workspaceId">

export type DocumentInput = Omit<DocumentRecord, "id" | "workspaceId">

export function WorkspaceDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: WorkspaceInput) => void
}) {
  const [name, setName] = useState("")
  const [accessMode, setAccessMode] = useState<AccessMode>("shared")
  const [currencyCode, setCurrencyCode] = useState("RUB")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!name.trim()) {
      return
    }

    onSubmit({
      name: name.trim(),
      accessMode,
      currencyCode,
    })
    setName("")
    setAccessMode("shared")
    setCurrencyCode("RUB")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое пространство</DialogTitle>
          <DialogDescription>
            Создайте индивидуальный или совместный бюджет.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspaceName">Название</FieldLabel>
              <Input
                id="workspaceName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например: Семья Нееловых"
                required
              />
            </Field>
            <Field>
              <FieldLabel>Модель доступа</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={accessMode === "shared" ? "default" : "outline"}
                  onClick={() => setAccessMode("shared")}
                >
                  Совместное
                </Button>
                <Button
                  type="button"
                  variant={accessMode === "individual" ? "default" : "outline"}
                  onClick={() => setAccessMode("individual")}
                >
                  Индивидуальное
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel>Валюта</FieldLabel>
              <CurrencySelect value={currencyCode} onChange={setCurrencyCode} />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Создать</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TransactionDialog({
  open,
  categories,
  currencyCode,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  categories: Category[]
  currencyCode: string
  onOpenChange: (open: boolean) => void
  onSubmit: (input: TransactionInput) => void
}) {
  const [type, setType] = useState<Transaction["type"]>("expense")
  const [title, setTitle] = useState("")
  const [amount, setAmount] = useState("")
  const [account, setAccount] = useState("Основной счет")
  const [categoryId, setCategoryId] = useState(
    getDefaultCategoryId(categories, "expense")
  )
  const [newCategory, setNewCategory] = useState("")
  const [date, setDate] = useState(formatDateKey(new Date()))
  const resolvedCategoryId = resolveTransactionCategoryId(
    categories,
    categoryId,
    type
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedAmount = Number(amount)
    const shouldCreateCategory = resolvedCategoryId === "__new__"

    if (
      !title.trim() ||
      Number.isNaN(parsedAmount) ||
      parsedAmount <= 0 ||
      (shouldCreateCategory && !newCategory.trim())
    ) {
      return
    }

    onSubmit({
      title: title.trim(),
      amount: parsedAmount,
      account: account.trim() || "Основной счет",
      categoryId: shouldCreateCategory ? "__new__" : resolvedCategoryId,
      newCategory: shouldCreateCategory
        ? { name: newCategory.trim(), kind: type }
        : undefined,
      type,
      date,
    })
    setTitle("")
    setAmount("")
    setAccount("Основной счет")
    setNewCategory("")
    setDate(formatDateKey(new Date()))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новая операция</DialogTitle>
          <DialogDescription>
            Выберите категорию из шаблона или создайте свою.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Тип</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={type === "expense" ? "default" : "outline"}
                  onClick={() => setType("expense")}
                >
                  Расход
                </Button>
                <Button
                  type="button"
                  variant={type === "income" ? "default" : "outline"}
                  onClick={() => setType("income")}
                >
                  Доход
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="transactionTitle">Название</FieldLabel>
              <Input
                id="transactionTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="transactionAmount">
                  Сумма, {currencyCode}
                </FieldLabel>
                <Input
                  id="transactionAmount"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="transactionDate">Дата</FieldLabel>
                <Input
                  id="transactionDate"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Категория</FieldLabel>
              <CategorySelect
                categories={categories}
                value={resolvedCategoryId}
                onChange={setCategoryId}
              />
            </Field>
            {resolvedCategoryId === "__new__" ? (
              <Field>
                <FieldLabel htmlFor="transactionNewCategory">
                  Новая категория
                </FieldLabel>
                <Input
                  id="transactionNewCategory"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  required
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="transactionAccount">Счет</FieldLabel>
              <Input
                id="transactionAccount"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BudgetDialog({
  open,
  categories,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  categories: Category[]
  onOpenChange: (open: boolean) => void
  onSubmit: (input: BudgetInput) => void
}) {
  const [categoryId, setCategoryId] = useState(
    getDefaultCategoryId(categories, "expense")
  )
  const [newCategory, setNewCategory] = useState("")
  const [limit, setLimit] = useState("")
  const [period, setPeriod] = useState<Budget["period"]>("month")
  const resolvedCategoryId = resolveBudgetCategoryId(categories, categoryId)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedLimit = Number(limit)
    const shouldCreateCategory = resolvedCategoryId === "__new__"

    if (
      Number.isNaN(parsedLimit) ||
      parsedLimit <= 0 ||
      (shouldCreateCategory && !newCategory.trim())
    ) {
      return
    }

    onSubmit({
      categoryId: shouldCreateCategory ? "__new__" : resolvedCategoryId,
      limit: parsedLimit,
      period,
      newCategory: shouldCreateCategory
        ? { name: newCategory.trim(), kind: "expense" }
        : undefined,
    })
    setLimit("")
    setNewCategory("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый бюджет</DialogTitle>
          <DialogDescription>
            Лимит применяется к выбранной категории.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Категория</FieldLabel>
              <CategorySelect
                categories={categories}
                value={resolvedCategoryId}
                onChange={setCategoryId}
              />
            </Field>
            {resolvedCategoryId === "__new__" ? (
              <Field>
                <FieldLabel htmlFor="budgetNewCategory">
                  Новая категория
                </FieldLabel>
                <Input
                  id="budgetNewCategory"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  required
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="budgetLimit">Лимит</FieldLabel>
              <Input
                id="budgetLimit"
                type="number"
                min="1"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Период</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {(["month", "quarter", "year"] as const).map((item) => (
                  <Button
                    key={item}
                    type="button"
                    variant={period === item ? "default" : "outline"}
                    onClick={() => setPeriod(item)}
                  >
                    {item === "month"
                      ? "Месяц"
                      : item === "quarter"
                        ? "Квартал"
                        : "Год"}
                  </Button>
                ))}
              </div>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function getDefaultCategoryId(categories: Category[], kind: Category["kind"]) {
  return (
    categories.find((category) => category.kind === kind)?.id ??
    categories.find((category) => category.kind === "expense")?.id ??
    categories[0]?.id ??
    ""
  )
}

function resolveTransactionCategoryId(
  categories: Category[],
  categoryId: string,
  type: Transaction["type"]
) {
  if (categoryId === "__new__") {
    return categoryId
  }

  const selected = categories.find((category) => category.id === categoryId)

  if (
    selected &&
    (selected.kind === type ||
      selected.kind === "neutral" ||
      (type === "expense" && selected.kind !== "income"))
  ) {
    return selected.id
  }

  return getDefaultCategoryId(categories, type)
}

function resolveBudgetCategoryId(categories: Category[], categoryId: string) {
  if (categoryId === "__new__") {
    return categoryId
  }

  const selected = categories.find((category) => category.id === categoryId)

  if (selected && selected.kind !== "income") {
    return selected.id
  }

  return getDefaultCategoryId(categories, "expense")
}

export function InviteDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: InviteInput) => void
}) {
  const [email, setEmail] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email.trim()) {
      return
    }

    onSubmit({ email: email.trim() })
    setEmail("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пригласить участника</DialogTitle>
          <DialogDescription>
            Пользователь появится в карточке пространства со статусом invited.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="inviteEmail">Email</FieldLabel>
              <Input
                id="inviteEmail"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">
                <MailIcon data-icon="inline-start" />
                Отправить
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LiabilityDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: LiabilityInput) => void
}) {
  const [title, setTitle] = useState("")
  const [balance, setBalance] = useState("")
  const [monthlyPayment, setMonthlyPayment] = useState("")
  const [rate, setRate] = useState("")
  const [nextPayment, setNextPayment] = useState(formatDateKey(new Date()))

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedBalance = Number(balance)
    const parsedPayment = Number(monthlyPayment)
    const parsedRate = Number(rate)

    if (
      !title.trim() ||
      Number.isNaN(parsedBalance) ||
      Number.isNaN(parsedPayment) ||
      parsedBalance <= 0 ||
      parsedPayment <= 0
    ) {
      return
    }

    onSubmit({
      title: title.trim(),
      balance: parsedBalance,
      monthlyPayment: parsedPayment,
      rate: Number.isNaN(parsedRate) ? 0 : parsedRate,
      nextPayment,
    })
    setTitle("")
    setBalance("")
    setMonthlyPayment("")
    setRate("")
    setNextPayment(formatDateKey(new Date()))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новое обязательство</DialogTitle>
          <DialogDescription>
            Платеж появится в календаре на выбранную дату.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="liabilityTitle">Название</FieldLabel>
              <Input
                id="liabilityTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="liabilityBalance">Остаток</FieldLabel>
                <Input
                  id="liabilityBalance"
                  type="number"
                  min="1"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="liabilityPayment">Платеж</FieldLabel>
                <Input
                  id="liabilityPayment"
                  type="number"
                  min="1"
                  value={monthlyPayment}
                  onChange={(event) => setMonthlyPayment(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="liabilityRate">Ставка, %</FieldLabel>
                <Input
                  id="liabilityRate"
                  type="number"
                  min="0"
                  step="0.1"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="liabilityDate">Следующий платеж</FieldLabel>
                <Input
                  id="liabilityDate"
                  type="date"
                  value={nextPayment}
                  onChange={(event) => setNextPayment(event.target.value)}
                  required
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DocumentDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: DocumentInput) => void
}) {
  const [title, setTitle] = useState("")
  const [fileName, setFileName] = useState("")
  const [linkedTo, setLinkedTo] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!fileName) {
      return
    }

    onSubmit({
      title: title.trim() || fileName,
      fileName,
      linkedTo: linkedTo.trim() || "Не привязан",
      status: "uploaded",
      uploadedAt: formatDateKey(new Date()),
    })
    setTitle("")
    setFileName("")
    setLinkedTo("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Загрузить документ</DialogTitle>
          <DialogDescription>
            Документ сохраняется как запись активного пространства.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="documentFile">Файл</FieldLabel>
              <Input
                id="documentFile"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) =>
                  setFileName(event.currentTarget.files?.[0]?.name ?? "")
                }
                required
              />
              <FieldDescription>PDF или изображение.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="documentTitle">Название</FieldLabel>
              <Input
                id="documentTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="documentLinkedTo">Привязка</FieldLabel>
              <Input
                id="documentLinkedTo"
                value={linkedTo}
                onChange={(event) => setLinkedTo(event.target.value)}
                placeholder="Например: ипотека или чек"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">
                <UploadIcon data-icon="inline-start" />
                Загрузить
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
