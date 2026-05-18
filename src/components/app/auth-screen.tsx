import { type FormEvent, useState } from "react"
import { BanknoteIcon, LogInIcon, UserPlusIcon } from "lucide-react"

import { FadeContent } from "@/components/reactbits/fade-content"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
}: {
  onRegister: (input: RegisterInput) => Promise<void>
  onLogin: (input: LoginInput) => Promise<void>
}) {
  const [mode, setMode] = useState("login")
  const [register, setRegister] = useState<RegisterInput>({
    name: "",
    email: "",
    password: "",
  })
  const [login, setLogin] = useState<LoginInput>({ email: "", password: "" })

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onRegister(register)
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onLogin(login)
  }

  return (
    <main className="auth-shell min-h-svh p-4">
      <FadeContent className="w-full max-w-[960px]">
        <div className="grid overflow-hidden rounded-xl border bg-card shadow-xl md:grid-cols-[0.85fr_1.15fr]">
          <section className="hidden min-h-[560px] flex-col justify-between bg-primary p-8 text-primary-foreground md:flex">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary-foreground/15">
                <BanknoteIcon />
              </div>
              <div>
                <div className="text-lg font-semibold">BestBudget</div>
                <div className="text-sm opacity-80">Бюджет без хаоса</div>
              </div>
            </div>
            <div>
              <h1 className="text-4xl font-semibold leading-tight">
                Входите в свой аккаунт и ведите несколько пространств.
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 opacity-80">
                Данные операций, бюджетов, семьи и календаря привязаны к
                вашему email и паролю в локальной модели приложения.
              </p>
            </div>
          </section>

          <section className="flex min-h-[560px] items-center justify-center p-5 md:p-10">
            <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
              <CardHeader className="px-0">
                <CardTitle>BestBudget</CardTitle>
                <CardDescription>
                  Выберите вход или регистрацию нового аккаунта.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <Tabs value={mode} onValueChange={setMode}>
                  <TabsList className="w-full">
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
                        <Button type="submit" size="lg">
                          <LogInIcon data-icon="inline-start" />
                          Войти
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
                          <FieldLabel htmlFor="registerPassword">
                            Пароль
                          </FieldLabel>
                          <Input
                            id="registerPassword"
                            type="password"
                            autoComplete="new-password"
                            minLength={6}
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
                        <Button type="submit" size="lg">
                          <UserPlusIcon data-icon="inline-start" />
                          Зарегистрироваться
                        </Button>
                      </FieldGroup>
                    </form>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </section>
        </div>
      </FadeContent>
    </main>
  )
}
