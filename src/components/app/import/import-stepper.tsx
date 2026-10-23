import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const steps = ["Файл", "Настройка", "Проверка", "Готово"]

export function ImportStepper({ step }: { step: number }) {
  return (
    <nav aria-label="Этапы импорта">
      <p className="text-sm font-medium text-primary sm:hidden">
        Шаг {step} из 4 · {steps[step - 1]}
      </p>
      <ol className="hidden items-center gap-3 sm:flex">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={step === index + 1 ? "step" : undefined}
            className={cn("flex items-center gap-2 text-sm text-muted-foreground", step === index + 1 && "font-medium text-primary")}
          >
            {index ? <span aria-hidden className="mr-1 h-px w-8 bg-border" /> : null}
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full border text-xs",
                step === index + 1 && "border-primary bg-primary text-primary-foreground",
                step > index + 1 && "border-primary/20 bg-primary/10 text-primary",
              )}
            >
              {step > index + 1 ? <Check className="size-3.5" /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </nav>
  )
}
