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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
import {
  isEmailLike,
  isValidDateKey,
  parseNonNegativeDecimalInput,
  parsePositiveMoneyInput,
} from "@/domain/validation"

const MAX_DOCUMENT_FILE_BYTES = 1_500_000

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
  const [formError, setFormError] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    if (!name.trim()) {
      setFormError("Введите название бюджета.")
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
    setFormError("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый бюджет</DialogTitle>
          <DialogDescription>
            Выберите название, валюту и формат доступа.
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
              <FieldLabel>Кто будет пользоваться</FieldLabel>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Кто будет пользоваться бюджетом"
              >
                <Button
                  type="button"
                  variant={accessMode === "shared" ? "default" : "outline"}
                  aria-pressed={accessMode === "shared"}
                  onClick={() => setAccessMode("shared")}
                >
                  Вместе
                </Button>
                <Button
                  type="button"
                  variant={accessMode === "individual" ? "default" : "outline"}
                  aria-pressed={accessMode === "individual"}
                  onClick={() => setAccessMode("individual")}
                >
                  Только я
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel>Валюта</FieldLabel>
              <CurrencySelect value={currencyCode} onChange={setCurrencyCode} />
            </Field>
            <FieldError>{formError}</FieldError>
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
  const [formError, setFormError] = useState("")
  const categoryOptions = getTransactionCategoryOptions(categories, type)
  const resolvedCategoryId = resolveTransactionCategoryId(
    categoryOptions,
    categoryId,
    type
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    const parsedAmount = parsePositiveMoneyInput(amount)
    const shouldCreateCategory = resolvedCategoryId === "__new__"

    if (!title.trim()) {
      setFormError("Введите название операции.")
      return
    }

    if (parsedAmount === null) {
      setFormError("Введите сумму больше нуля, максимум с двумя знаками.")
      return
    }

    if (!isValidDateKey(date)) {
      setFormError("Выберите корректную дату операции.")
      return
    }

    if (shouldCreateCategory && !newCategory.trim()) {
      setFormError("Введите название новой категории.")
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
    setFormError("")
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
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Тип операции"
              >
                <Button
                  type="button"
                  variant={type === "expense" ? "default" : "outline"}
                  aria-pressed={type === "expense"}
                  onClick={() => setType("expense")}
                >
                  Расход
                </Button>
                <Button
                  type="button"
                  variant={type === "income" ? "default" : "outline"}
                  aria-pressed={type === "income"}
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
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
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
                categories={categoryOptions}
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
            <FieldError>{formError}</FieldError>
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
  const [formError, setFormError] = useState("")
  const categoryOptions = getBudgetCategoryOptions(categories)
  const resolvedCategoryId = resolveBudgetCategoryId(categoryOptions, categoryId)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    const parsedLimit = parsePositiveMoneyInput(limit)
    const shouldCreateCategory = resolvedCategoryId === "__new__"

    if (parsedLimit === null) {
      setFormError("Введите лимит больше нуля, максимум с двумя знаками.")
      return
    }

    if (shouldCreateCategory && !newCategory.trim()) {
      setFormError("Введите название новой категории.")
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
    setFormError("")
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
                categories={categoryOptions}
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
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Период</FieldLabel>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Период бюджета"
              >
                {(["month", "quarter", "year"] as const).map((item) => (
                  <Button
                    key={item}
                    type="button"
                    variant={period === item ? "default" : "outline"}
                    aria-pressed={period === item}
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
            <FieldError>{formError}</FieldError>
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
    "__new__"
  )
}

function getTransactionCategoryOptions(
  categories: Category[],
  type: Transaction["type"]
) {
  return categories.filter((category) =>
    type === "income"
      ? category.kind === "income" || category.kind === "neutral"
      : category.kind === "expense" || category.kind === "neutral"
  )
}

function getBudgetCategoryOptions(categories: Category[]) {
  return categories.filter((category) => category.kind !== "income")
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
  const [formError, setFormError] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    if (!isEmailLike(email)) {
      setFormError("Введите корректный email участника.")
      return
    }

    onSubmit({ email: email.trim() })
    setEmail("")
    setFormError("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пригласить участника</DialogTitle>
          <DialogDescription>
            Участник появится в списке семьи со статусом приглашения.
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
            <FieldError>{formError}</FieldError>
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
  const [formError, setFormError] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    const parsedBalance = parsePositiveMoneyInput(balance)
    const parsedPayment = parsePositiveMoneyInput(monthlyPayment)
    const parsedRate = rate.trim() ? parseNonNegativeDecimalInput(rate) : 0

    if (!title.trim()) {
      setFormError("Введите название обязательства.")
      return
    }

    if (parsedBalance === null) {
      setFormError("Введите остаток больше нуля, максимум с двумя знаками.")
      return
    }

    if (parsedPayment === null) {
      setFormError("Введите платеж больше нуля, максимум с двумя знаками.")
      return
    }

    if (parsedRate === null) {
      setFormError("Введите ставку числом не меньше нуля.")
      return
    }

    if (!isValidDateKey(nextPayment)) {
      setFormError("Выберите корректную дату платежа.")
      return
    }

    onSubmit({
      title: title.trim(),
      balance: parsedBalance,
      monthlyPayment: parsedPayment,
      rate: parsedRate,
      nextPayment,
    })
    setTitle("")
    setBalance("")
    setMonthlyPayment("")
    setRate("")
    setNextPayment(formatDateKey(new Date()))
    setFormError("")
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
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
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
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
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
                  inputMode="decimal"
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
            <FieldError>{formError}</FieldError>
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
  const [file, setFile] = useState<File | null>(null)
  const [linkedTo, setLinkedTo] = useState("")
  const [formError, setFormError] = useState("")
  const [pending, setPending] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    if (!file || !fileName) {
      setFormError("Выберите файл.")
      return
    }

    if (file.size > MAX_DOCUMENT_FILE_BYTES) {
      setFormError("Файл должен быть не больше 1.5 МБ для локального хранения.")
      return
    }

    setPending(true)
    try {
      const fileData = await readFileAsDataUrl(file)

      onSubmit({
        title: title.trim() || fileName,
        fileName,
        fileData,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        linkedTo: linkedTo.trim() || "Не привязан",
        status: "uploaded",
        uploadedAt: formatDateKey(new Date()),
      })
      setTitle("")
      setFileName("")
      setFile(null)
      setLinkedTo("")
      setFileInputKey((current) => current + 1)
      setFormError("")
    } catch {
      setFormError("Не удалось прочитать файл.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Загрузить документ</DialogTitle>
          <DialogDescription>
            Документ будет привязан к выбранному бюджету.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="documentFile">Файл</FieldLabel>
              <Input
                key={fileInputKey}
                id="documentFile"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => {
                  const selectedFile = event.currentTarget.files?.[0] ?? null
                  setFile(selectedFile)
                  setFileName(selectedFile?.name ?? "")
                  setFormError("")
                }}
                required
              />
              <FieldDescription>
                PDF или изображение до 1.5 МБ хранится локально в браузере.
              </FieldDescription>
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
            <FieldError>{formError}</FieldError>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                <UploadIcon data-icon="inline-start" />
                {pending ? "Загружаем..." : "Загрузить"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }

      reject(new Error("Unexpected file reader result"))
    })
    reader.addEventListener("error", () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}
