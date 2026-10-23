import { getTranslations } from "next-intl/server"

export async function GET() {
  const t = await getTranslations("import")
  const csv =
    `\ufeffaccount;date;amount;currency;description;external_id;status;mcc\r\nDEMO_DEBIT_A;2026-10-20;-450.00;RUB;MAGAZIN PRIMER;;posted;5411\r\nDEMO_DEBIT_A;2026-10-21;50.00;RUB;${t("template.cashback")};;posted;\r\n`
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bestbudget-v1.csv"',
      "Cache-Control": "no-store",
    },
  })
}
