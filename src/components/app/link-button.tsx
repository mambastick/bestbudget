import type { VariantProps } from "class-variance-authority"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** A navigation link styled as a button (keeps link semantics, unlike rendering <Button> as a link). */
export function LinkButton({ className, variant, size, ...props }: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
