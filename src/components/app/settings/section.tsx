import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function Section({ title, description, children, action }: { title: string; description?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="gap-x-3">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
