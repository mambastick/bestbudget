import { type FormEvent, useState } from "react"
import { MailIcon, ShieldCheckIcon, UploadIcon } from "lucide-react"

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
  SsoProviderKind,
  Transaction,
  WorkspaceRole,
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
  | "sso"
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

export type SsoIdpConfig = {
  enabled: boolean
  providerKind: SsoProviderKind
  providerName: string
  issuerUrl: string
  clientId: string
  scopes: string
  domainHint: string
  roleClaim: string
  defaultRole: Exclude<WorkspaceRole, "owner">
  allowOwnerRoleMapping: boolean
  ownerRoleValues: string
  adminRoleValues: string
  memberRoleValues: string
  observerRoleValues: string
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

export function SsoIdpDialog({
  open,
  initialConfig,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  initialConfig: SsoIdpConfig | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: SsoIdpConfig) => void
}) {
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false)
  const [providerKind, setProviderKind] = useState<SsoProviderKind>(
    initialConfig?.providerKind ?? "keycloak"
  )
  const [providerName, setProviderName] = useState(
    initialConfig?.providerName ?? "Keycloak"
  )
  const [issuerUrl, setIssuerUrl] = useState(initialConfig?.issuerUrl ?? "")
  const [clientId, setClientId] = useState(initialConfig?.clientId ?? "")
  const [scopes, setScopes] = useState(
    initialConfig?.scopes ?? "openid profile email"
  )
  const [domainHint, setDomainHint] = useState(initialConfig?.domainHint ?? "")
  const [roleClaim, setRoleClaim] = useState(
    initialConfig?.roleClaim ?? getDefaultRoleClaim(initialConfig?.providerKind ?? "keycloak")
  )
  const [defaultRole, setDefaultRole] =
    useState<Exclude<WorkspaceRole, "owner">>(initialConfig?.defaultRole ?? "member")
  const [allowOwnerRoleMapping, setAllowOwnerRoleMapping] = useState(
    initialConfig?.allowOwnerRoleMapping ?? false
  )
  const [ownerRoleValues, setOwnerRoleValues] = useState(
    initialConfig?.ownerRoleValues ?? ""
  )
  const [adminRoleValues, setAdminRoleValues] = useState(
    initialConfig?.adminRoleValues ?? "bestbudget-admins"
  )
  const [memberRoleValues, setMemberRoleValues] = useState(
    initialConfig?.memberRoleValues ?? "bestbudget-members"
  )
  const [observerRoleValues, setObserverRoleValues] = useState(
    initialConfig?.observerRoleValues ?? "bestbudget-observers"
  )
  const [formError, setFormError] = useState("")

  function selectProviderKind(nextKind: SsoProviderKind) {
    setProviderKind(nextKind)
    setProviderName((current) => current || getProviderKindLabel(nextKind))
    setRoleClaim(getDefaultRoleClaim(nextKind))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")

    const trimmedProviderName = providerName.trim()
    const trimmedIssuerUrl = issuerUrl.trim()
    const trimmedClientId = clientId.trim()
    const trimmedScopes = scopes.trim()
    const trimmedDomainHint = domainHint.trim()
    const trimmedRoleClaim = roleClaim.trim()
    const hasProviderFields = Boolean(
      trimmedProviderName ||
        trimmedIssuerUrl ||
        trimmedClientId ||
        trimmedDomainHint
    )

    if (
      (enabled || hasProviderFields) &&
      (!trimmedProviderName || !trimmedIssuerUrl || !trimmedClientId)
    ) {
      setFormError("Укажите провайдера, issuer URL и client ID.")
      return
    }

    if ((enabled || hasProviderFields) && !isAllowedOidcIssuerUrl(trimmedIssuerUrl)) {
      setFormError("Issuer URL должен быть https:// или локальным http://localhost.")
      return
    }

    if (
      (enabled || hasProviderFields) &&
      !trimmedScopes.split(/\s+/).includes("openid")
    ) {
      setFormError("Для OIDC добавьте scope openid.")
      return
    }

    onSubmit({
      enabled,
      providerKind,
      providerName: trimmedProviderName,
      issuerUrl: trimmedIssuerUrl,
      clientId: trimmedClientId,
      scopes: trimmedScopes || "openid profile email",
      domainHint: trimmedDomainHint,
      roleClaim: trimmedRoleClaim || getDefaultRoleClaim(providerKind),
      defaultRole,
      allowOwnerRoleMapping,
      ownerRoleValues: ownerRoleValues.trim(),
      adminRoleValues: adminRoleValues.trim(),
      memberRoleValues: memberRoleValues.trim(),
      observerRoleValues: observerRoleValues.trim(),
    })
    setFormError("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Настройка IdP</DialogTitle>
          <DialogDescription>
            Параметры SSO для выбранного бюджета и сопоставления ролей RBAC.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Статус SSO</FieldLabel>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Статус SSO"
              >
                <Button
                  type="button"
                  variant={enabled ? "default" : "outline"}
                  aria-pressed={enabled}
                  onClick={() => setEnabled(true)}
                >
                  Включено
                </Button>
                <Button
                  type="button"
                  variant={!enabled ? "default" : "outline"}
                  aria-pressed={!enabled}
                  onClick={() => setEnabled(false)}
                >
                  Отключено
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel>Тип провайдера</FieldLabel>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Тип SSO провайдера"
              >
                {(["oidc", "keycloak", "authentik"] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant={providerKind === kind ? "default" : "outline"}
                    aria-pressed={providerKind === kind}
                    onClick={() => selectProviderKind(kind)}
                  >
                    {getProviderKindLabel(kind)}
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="ssoProviderName">Провайдер</FieldLabel>
              <Input
                id="ssoProviderName"
                value={providerName}
                onChange={(event) => setProviderName(event.target.value)}
                placeholder="Например: Okta или Microsoft Entra ID"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ssoIssuerUrl">Issuer URL</FieldLabel>
              <Input
                id="ssoIssuerUrl"
                type="url"
                value={issuerUrl}
                onChange={(event) => setIssuerUrl(event.target.value)}
                placeholder="https://idp.example.com/oauth2/default"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ssoClientId">Client ID</FieldLabel>
              <Input
                id="ssoClientId"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="bestbudget-web"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ssoDomainHint">Домен</FieldLabel>
                <Input
                  id="ssoDomainHint"
                  value={domainHint}
                  onChange={(event) => setDomainHint(event.target.value)}
                  placeholder="company.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ssoRoleClaim">RBAC claim</FieldLabel>
                <Input
                  id="ssoRoleClaim"
                  value={roleClaim}
                  onChange={(event) => setRoleClaim(event.target.value)}
                  placeholder="groups"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="ssoScopes">Scopes</FieldLabel>
              <Input
                id="ssoScopes"
                value={scopes}
                onChange={(event) => setScopes(event.target.value)}
                placeholder="openid email profile"
              />
            </Field>
            <Field>
              <FieldLabel>Роль по умолчанию</FieldLabel>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Роль по умолчанию для SSO"
              >
                {(["admin", "member", "observer"] as const).map((role) => (
                  <Button
                    key={role}
                    type="button"
                    variant={defaultRole === role ? "default" : "outline"}
                    aria-pressed={defaultRole === role}
                    onClick={() => setDefaultRole(role)}
                  >
                    {role === "admin"
                      ? "Админ"
                      : role === "member"
                        ? "Участник"
                        : "Просмотр"}
                  </Button>
                ))}
              </div>
            </Field>
            <Field orientation="horizontal">
              <input
                id="ssoOwnerMapping"
                type="checkbox"
                className="mt-0.5 size-4 rounded border border-input accent-primary"
                checked={allowOwnerRoleMapping}
                onChange={(event) =>
                  setAllowOwnerRoleMapping(event.target.checked)
                }
              />
              <div>
                <FieldLabel htmlFor="ssoOwnerMapping">
                  Разрешить mapping в роль владельца
                </FieldLabel>
                <FieldDescription>
                  Используйте только для доверенного IdP и ограниченной группы.
                </FieldDescription>
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {allowOwnerRoleMapping ? (
                <Field>
                  <FieldLabel htmlFor="ssoOwnerValues">Owner values</FieldLabel>
                  <Input
                    id="ssoOwnerValues"
                    value={ownerRoleValues}
                    onChange={(event) => setOwnerRoleValues(event.target.value)}
                    placeholder="finance-owners"
                  />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="ssoAdminValues">Admin values</FieldLabel>
                <Input
                  id="ssoAdminValues"
                  value={adminRoleValues}
                  onChange={(event) => setAdminRoleValues(event.target.value)}
                  placeholder="finance-admins"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ssoMemberValues">Member values</FieldLabel>
                <Input
                  id="ssoMemberValues"
                  value={memberRoleValues}
                  onChange={(event) => setMemberRoleValues(event.target.value)}
                  placeholder="finance-users"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ssoObserverValues">Observer values</FieldLabel>
                <Input
                  id="ssoObserverValues"
                  value={observerRoleValues}
                  onChange={(event) => setObserverRoleValues(event.target.value)}
                  placeholder="finance-viewers"
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
              <Button type="submit">
                <ShieldCheckIcon data-icon="inline-start" />
                Сохранить IdP
              </Button>
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

function getProviderKindLabel(kind: SsoProviderKind) {
  if (kind === "keycloak") {
    return "Keycloak"
  }

  if (kind === "authentik") {
    return "Authentik"
  }

  return kind === "saml" ? "SAML" : "OIDC"
}

function getDefaultRoleClaim(kind: SsoProviderKind) {
  return kind === "keycloak" ? "realm_access.roles" : "groups"
}

function isAllowedOidcIssuerUrl(value: string) {
  try {
    const url = new URL(value)

    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    )
  } catch {
    return false
  }
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
