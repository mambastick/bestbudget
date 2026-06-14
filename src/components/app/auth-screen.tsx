import { type FormEvent, useState } from "react"
import {
  BanknoteIcon,
  CalendarDaysIcon,
  LogInIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  SparklesIcon,
  UserPlusIcon,
} from "lucide-react"

import { FadeContent } from "@/components/reactbits/fade-content"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type RegisterInput = {
  name: string
  email: string
  password: string
}

export type LoginInput = {
  email: string
  password: string
}

export function AuthScreen({
  onRegister,
  onLogin,
  onDemo,
}: {
  onRegister: (input: RegisterInput) => Promise<void>
  onLogin: (input: LoginInput) => Promise<void>
  onDemo: () => Promise<void>
}) {
  const [mode, setMode] = useState("login")
  const [pendingAction, setPendingAction] = useState<
    "login" | "register" | "demo" | null
  >(null)
  const [register, setRegister] = useState<RegisterInput>({
    name: "",
    email: "",
    password: "",
  })
  const [login, setLogin] = useState<LoginInput>({ email: "", password: "" })

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction("register")
    try {
      await onRegister(register)
    } finally {
      setPendingAction(null)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction("login")
    try {
      await onLogin(login)
    } finally {
      setPendingAction(null)
    }
  }

  async function handleDemo() {
    setPendingAction("demo")
    try {
      await onDemo()
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <main className="auth-shell min-h-svh p-4">
      <FadeContent className="w-full max-w-[1080px]">
        <div className="grid overflow-hidden rounded-xl border bg-background shadow-xl lg:min-h-[640px] lg:grid-cols-[1fr_0.9fr]">
          <section className="hidden flex-col justify-between bg-zinc-950 p-10 text-white lg:flex">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-white/10 text-white">
                <BanknoteIcon />
              </div>
              <div>
                <div className="text-xl font-semibold">BestBudget</div>
                <div className="text-sm text-white/65">Бюджет без хаоса</div>
              </div>
            </div>
            <div className="max-w-lg">
              <h1 className="text-5xl font-semibold leading-tight">
                Деньги, лимиты и платежи в одном месте.
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-white/70">
                Ведите личный или семейный бюджет: добавляйте операции,
                планируйте обязательные платежи и сразу видьте, что происходит
                с деньгами.
              </p>
            </div>
            <div className="grid gap-3">
              {[
                {
                  icon: ReceiptTextIcon,
                  title: "Операции",
                  text: "Доходы, расходы и счета без лишних шагов.",
                },
                {
                  icon: PiggyBankIcon,
                  title: "Лимиты",
                  text: "Понятный контроль категорий на месяц.",
                },
                {
                  icon: CalendarDaysIcon,
                  title: "Календарь",
                  text: "Даты платежей и событий перед глазами.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex items-center gap-3 border-t border-white/10 pt-3"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-white/80">
                    <item.icon />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-sm text-white/55">{item.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-[calc(100svh-2rem)] items-center justify-center p-5 sm:min-h-[620px] sm:p-8 lg:min-h-0 lg:p-12">
            <div className="w-full max-w-md">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BanknoteIcon />
                </div>
                <div>
                  <div className="font-semibold">BestBudget</div>
                  <div className="text-sm text-muted-foreground">
                    Бюджет без хаоса
                  </div>
                </div>
              </div>
              <div className="mb-6">
                <h2 className="text-3xl font-semibold tracking-normal">
                  {mode === "login" ? "Войти" : "Создать аккаунт"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {mode === "login"
                    ? "Продолжите учет расходов, лимитов и ближайших платежей."
                    : "Понадобятся только имя, email и пароль. Настроить бюджет можно после входа."}
                </p>
              </div>
              <Tabs value={mode} onValueChange={setMode}>
                <TabsList className="mb-5 w-full">
                  <TabsTrigger value="login" className="flex-1">
                    Вход
                  </TabsTrigger>
                  <TabsTrigger value="register" className="flex-1">
                    Регистрация
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="login">
                  <form onSubmit={handleLogin}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="loginEmail">Email</FieldLabel>
                        <Input
                          id="loginEmail"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={login.email}
                          onChange={(event) =>
                            setLogin((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="loginPassword">Пароль</FieldLabel>
                        <Input
                          id="loginPassword"
                          type="password"
                          autoComplete="current-password"
                          placeholder="Ваш пароль"
                          value={login.password}
                          onChange={(event) =>
                            setLogin((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          required
                        />
                      </Field>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={pendingAction !== null}
                      >
                        <LogInIcon data-icon="inline-start" />
                        {pendingAction === "login" ? "Входим..." : "Войти"}
                      </Button>
                    </FieldGroup>
                  </form>
                </TabsContent>
                <TabsContent value="register">
                  <form onSubmit={handleRegister}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="registerName">Имя</FieldLabel>
                        <Input
                          id="registerName"
                          autoComplete="name"
                          placeholder="Как к вам обращаться"
                          value={register.name}
                          onChange={(event) =>
                            setRegister((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="registerEmail">Email</FieldLabel>
                        <Input
                          id="registerEmail"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={register.email}
                          onChange={(event) =>
                            setRegister((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="registerPassword">Пароль</FieldLabel>
                        <Input
                          id="registerPassword"
                          type="password"
                          autoComplete="new-password"
                          minLength={6}
                          placeholder="Минимум 6 символов"
                          value={register.password}
                          onChange={(event) =>
                            setRegister((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          required
                        />
                      </Field>
                      <Button
                        type="submit"
                        size="lg"
                        disabled={pendingAction !== null}
                      >
                        <UserPlusIcon data-icon="inline-start" />
                        {pendingAction === "register"
                          ? "Создаем..."
                          : "Создать аккаунт"}
                      </Button>
                    </FieldGroup>
                  </form>
                </TabsContent>
              </Tabs>
              <div className="mt-5 grid gap-3 border-t pt-5">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={pendingAction !== null}
                  onClick={handleDemo}
                >
                  <SparklesIcon data-icon="inline-start" />
                  {pendingAction === "demo" ? "Открываем..." : "Открыть демо"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </FadeContent>
    </main>
  )
}
