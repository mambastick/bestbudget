import { relations, sql } from "drizzle-orm"
import {
  AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const userStatus = pgEnum("user_status", [
  "active",
  "invited",
  "suspended",
  "deleted",
])
export const householdType = pgEnum("household_type", ["personal", "family"])
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
  "observer",
  "assistant",
])
export const accountType = pgEnum("account_type", [
  "cash",
  "checking",
  "savings",
  "credit_card",
  "loan",
  "investment",
])
export const transactionType = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
  "adjustment",
  "scheduled",
])
export const transactionStatus = pgEnum("transaction_status", [
  "draft",
  "planned",
  "posted",
  "reconciled",
  "void",
])
export const categoryKind = pgEnum("category_kind", [
  "income",
  "expense",
  "transfer",
])
export const budgetPeriodType = pgEnum("budget_period_type", [
  "month",
  "quarter",
  "year",
])
export const cadence = pgEnum("cadence", [
  "weekly",
  "biweekly",
  "monthly",
  "semimonthly",
  "custom",
])
export const allocationType = pgEnum("allocation_type", [
  "fixed_amount",
  "percentage",
])
export const liabilityType = pgEnum("liability_type", [
  "loan",
  "mortgage",
  "auto_loan",
  "installment",
  "credit_line",
])
export const rateType = pgEnum("rate_type", ["fixed", "variable"])
export const scheduleType = pgEnum("schedule_type", [
  "annuity",
  "differentiated",
  "manual",
])
export const liabilityScheduleStatus = pgEnum("liability_schedule_status", [
  "planned",
  "paid",
  "partial",
  "overdue",
  "skipped",
])
export const sourceType = pgEnum("source_type", [
  "manual",
  "ocr",
  "imported",
  "api",
])
export const documentLinkType = pgEnum("document_link_type", [
  "account",
  "transaction",
  "liability",
  "household",
])
export const verificationStatus = pgEnum("verification_status", [
  "pending",
  "verified",
  "rejected",
])
export const calendarItemType = pgEnum("calendar_item_type", [
  "income",
  "expense",
  "transfer",
  "liability_payment",
  "salary",
  "reminder",
])
export const calendarItemStatus = pgEnum("calendar_item_status", [
  "planned",
  "completed",
  "overdue",
  "cancelled",
  "variance",
])
export const notificationChannel = pgEnum("notification_channel", [
  "email",
  "web_push",
  "mobile_push",
  "in_app",
])
export const jobStatus = pgEnum("job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
])

const id = uuid("id").defaultRandom().primaryKey()
const createdAt = timestamp("created_at", { withTimezone: true })
  .defaultNow()
  .notNull()
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .defaultNow()
  .notNull()

export const users = pgTable(
  "users",
  {
    id,
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale").default("ru").notNull(),
    timezone: text("timezone").default("Europe/Moscow").notNull(),
    status: userStatus("status").default("active").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
)

export const identities = pgTable(
  "identities",
  {
    id,
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    providerType: text("provider_type").notNull(),
    providerSubject: text("provider_subject").notNull(),
    issuer: text("issuer").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    claims: jsonb("claims").$type<Record<string, unknown>>().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("identities_provider_subject_unique").on(
      table.issuer,
      table.providerSubject
    ),
    index("identities_user_id_idx").on(table.userId),
  ]
)

export const households = pgTable(
  "households",
  {
    id,
    type: householdType("type").default("personal").notNull(),
    name: text("name").notNull(),
    baseCurrency: text("base_currency").default("RUB").notNull(),
    ownerUserId: uuid("owner_user_id")
      .references(() => users.id)
      .notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [index("households_owner_user_id_idx").on(table.ownerUserId)]
)

export const memberships = pgTable(
  "memberships",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: membershipRole("role").default("member").notNull(),
    permissionsJson: jsonb("permissions_json")
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("memberships_household_user_unique").on(
      table.householdId,
      table.userId
    ),
    index("memberships_user_id_idx").on(table.userId),
  ]
)

export const accounts = pgTable(
  "accounts",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    type: accountType("type").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    balanceMode: text("balance_mode").default("calculated").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("accounts_household_id_idx").on(table.householdId),
    index("accounts_owner_user_id_idx").on(table.ownerUserId),
  ]
)

export const accountBalances = pgTable(
  "account_balances",
  {
    id,
    accountId: uuid("account_id")
      .references(() => accounts.id, { onDelete: "cascade" })
      .notNull(),
    calculatedBalance: numeric("calculated_balance", {
      precision: 18,
      scale: 2,
    }).notNull(),
    actualBalance: numeric("actual_balance", {
      precision: 18,
      scale: 2,
    }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [index("account_balances_account_as_of_idx").on(table.accountId)]
)

export const categories = pgTable(
  "categories",
  {
    id,
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "cascade",
    }),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    color: text("color").default("#52525b").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("categories_household_id_idx").on(table.householdId),
    index("categories_parent_id_idx").on(table.parentId),
  ]
)

export const tags = pgTable(
  "tags",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("tags_household_name_unique").on(table.householdId, table.name),
  ]
)

export const transactions = pgTable(
  "transactions",
  {
    id,
    accountId: uuid("account_id")
      .references(() => accounts.id)
      .notNull(),
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    type: transactionType("type").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    bookedAt: timestamp("booked_at", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    status: transactionStatus("status").default("posted").notNull(),
    note: text("note"),
    transferGroupId: uuid("transfer_group_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("transactions_household_occurred_idx").on(
      table.householdId,
      table.occurredAt
    ),
    index("transactions_account_occurred_idx").on(
      table.accountId,
      table.occurredAt
    ),
    index("transactions_category_id_idx").on(table.categoryId),
  ]
)

export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id,
    transactionId: uuid("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: uuid("category_id")
      .references(() => categories.id)
      .notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    createdAt,
  },
  (table) => [index("transaction_splits_transaction_idx").on(table.transactionId)]
)

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: uuid("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .notNull(),
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.transactionId, table.tagId],
      name: "transaction_tags_pk",
    }),
  ]
)

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    templateType: text("template_type").notNull(),
    rrule: text("rrule").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("recurring_rules_next_run_idx").on(table.nextRunAt)]
)

export const budgets = pgTable(
  "budgets",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    periodType: budgetPeriodType("period_type").default("month").notNull(),
    periodStart: date("period_start").notNull(),
    amountLimit: numeric("amount_limit", { precision: 18, scale: 2 }).notNull(),
    rolloverPolicy: text("rollover_policy").default("none").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("budgets_scope_unique").on(
      table.householdId,
      table.categoryId,
      table.periodType,
      table.periodStart
    ),
  ]
)

export const salaryProfiles = pgTable(
  "salary_profiles",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    employerName: text("employer_name").notNull(),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    cadence: cadence("cadence").default("monthly").notNull(),
    paydayRule: text("payday_rule").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("salary_profiles_household_user_idx").on(table.householdId)]
)

export const salaryAllocations = pgTable(
  "salary_allocations",
  {
    id,
    salaryProfileId: uuid("salary_profile_id")
      .references(() => salaryProfiles.id, { onDelete: "cascade" })
      .notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    allocationType: allocationType("allocation_type").notNull(),
    value: numeric("value", { precision: 18, scale: 2 }).notNull(),
    priority: integer("priority").default(100).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("salary_allocations_profile_priority_idx").on(
      table.salaryProfileId,
      table.priority
    ),
  ]
)

export const liabilities = pgTable(
  "liabilities",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    type: liabilityType("type").notNull(),
    lender: text("lender").notNull(),
    currency: text("currency").notNull(),
    principalAmount: numeric("principal_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    currentBalance: numeric("current_balance", {
      precision: 18,
      scale: 2,
    }).notNull(),
    rateType: rateType("rate_type").notNull(),
    interestRate: numeric("interest_rate", {
      precision: 8,
      scale: 4,
    }).notNull(),
    scheduleType: scheduleType("schedule_type").notNull(),
    startDate: date("start_date").notNull(),
    maturityDate: date("maturity_date").notNull(),
    nextDueDate: date("next_due_date"),
    plannedMonthlyPayment: numeric("planned_monthly_payment", {
      precision: 18,
      scale: 2,
    }),
    source: sourceType("source").default("manual").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("liabilities_household_next_due_idx").on(
      table.householdId,
      table.nextDueDate
    ),
  ]
)

export const liabilitySchedules = pgTable(
  "liability_schedules",
  {
    id,
    liabilityId: uuid("liability_id")
      .references(() => liabilities.id, { onDelete: "cascade" })
      .notNull(),
    dueDate: date("due_date").notNull(),
    principalDue: numeric("principal_due", { precision: 18, scale: 2 }).notNull(),
    interestDue: numeric("interest_due", { precision: 18, scale: 2 }).notNull(),
    totalDue: numeric("total_due", { precision: 18, scale: 2 }).notNull(),
    status: liabilityScheduleStatus("status").default("planned").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("liability_schedules_due_unique").on(
      table.liabilityId,
      table.dueDate
    ),
  ]
)

export const liabilityPayments = pgTable(
  "liability_payments",
  {
    id,
    liabilityId: uuid("liability_id")
      .references(() => liabilities.id, { onDelete: "cascade" })
      .notNull(),
    transactionId: uuid("transaction_id")
      .references(() => transactions.id)
      .notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    extraPrincipal: numeric("extra_principal", { precision: 18, scale: 2 }),
    createdAt,
  },
  (table) => [index("liability_payments_liability_idx").on(table.liabilityId)]
)

export const documents = pgTable(
  "documents",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    pageCount: integer("page_count"),
    checksum: text("checksum").notNull(),
    linkedEntityType: documentLinkType("linked_entity_type"),
    linkedEntityId: uuid("linked_entity_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("documents_object_key_unique").on(table.objectKey),
    index("documents_household_link_idx").on(
      table.householdId,
      table.linkedEntityType,
      table.linkedEntityId
    ),
  ]
)

export const documentExtractions = pgTable(
  "document_extractions",
  {
    id,
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").notNull(),
    version: text("version").notNull(),
    extractedJson: jsonb("extracted_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    confidenceJson: jsonb("confidence_json")
      .$type<Record<string, unknown>>()
      .default({}),
    status: verificationStatus("status").default("pending").notNull(),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [index("document_extractions_document_idx").on(table.documentId)]
)

export const calendarItems = pgTable(
  "calendar_items",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    date: date("date").notNull(),
    itemType: calendarItemType("item_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    title: text("title").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }),
    currency: text("currency"),
    status: calendarItemStatus("status").default("planned").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("calendar_items_household_date_idx").on(table.householdId, table.date),
  ]
)

export const notifications = pgTable(
  "notifications",
  {
    id,
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    channel: notificationChannel("channel").notNull(),
    template: text("template").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: jobStatus("status").default("queued").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("notifications_user_scheduled_idx").on(table.userId)]
)

export const auditLog = pgTable(
  "audit_log",
  {
    id,
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "set null",
    }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt,
  },
  (table) => [
    index("audit_log_household_created_idx").on(table.householdId, table.createdAt),
    index("audit_log_actor_created_idx").on(table.actorUserId, table.createdAt),
  ]
)

export const imports = pgTable(
  "imports",
  {
    id,
    householdId: uuid("household_id")
      .references(() => households.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    fileDocumentId: uuid("file_document_id").references(() => documents.id),
    fileHash: text("file_hash").notNull(),
    status: jobStatus("status").default("queued").notNull(),
    summaryJson: jsonb("summary_json").$type<Record<string, unknown>>().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("imports_household_file_hash_unique").on(
      table.householdId,
      table.fileHash
    ),
  ]
)

export const importRows = pgTable(
  "import_rows",
  {
    id,
    importId: uuid("import_id")
      .references(() => imports.id, { onDelete: "cascade" })
      .notNull(),
    rawPayloadJson: jsonb("raw_payload_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    normalizedPayloadJson: jsonb("normalized_payload_json")
      .$type<Record<string, unknown>>()
      .default({}),
    dedupeHash: text("dedupe_hash").notNull(),
    resultStatus: text("result_status").default("pending").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("import_rows_import_dedupe_unique").on(
      table.importId,
      table.dedupeHash
    ),
  ]
)

export const usersRelations = relations(users, ({ many }) => ({
  identities: many(identities),
  memberships: many(memberships),
  notifications: many(notifications),
}))

export const householdsRelations = relations(households, ({ many }) => ({
  memberships: many(memberships),
  accounts: many(accounts),
  budgets: many(budgets),
  liabilities: many(liabilities),
  documents: many(documents),
  calendarItems: many(calendarItems),
}))

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  household: one(households, {
    fields: [transactions.householdId],
    references: [households.id],
  }),
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  splits: many(transactionSplits),
}))

export const enableUuidExtension = sql`create extension if not exists "pgcrypto";`
