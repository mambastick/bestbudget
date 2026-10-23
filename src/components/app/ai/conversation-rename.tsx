"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { renameAiConversationAction } from "@/app/actions/ai"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAction } from "@/hooks/use-action"

export function ConversationRename({
  conversation,
  onClose,
}: {
  conversation: { id: string; title: string; version: number }
  onClose: () => void
}) {
  const t = useTranslations("ai")
  const [title, setTitle] = useState(conversation.title)
  const { pending, run } = useAction()
  function save(title: string | null) {
    run(() => renameAiConversationAction({ id: conversation.id, version: conversation.version, title }), { onSuccess: onClose })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("renameChat")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid min-w-0 grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            save(title.trim())
          }}
        >
          <Field>
            <FieldLabel htmlFor="conversation-title">{t("conversationTitle")}</FieldLabel>
            <Input
              id="conversation-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              disabled={pending}
              required
              autoFocus
            />
          </Field>
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" className="h-auto whitespace-normal" disabled={pending} onClick={() => save(null)}>
              {t("resetTitle")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {t("cancelTitle")}
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {t("saveTitle")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
