import { relations, sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const id = () => uuid("id").primaryKey().defaultRandom()
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
/** Money in currency-specific minor units. */
const money = (name: string) => bigint(name, { mode: "number" })

// ---------------------------------------------------------------------------
// Authentication (tables used by Better Auth through the Drizzle adapter)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Global application role: "admin" or "user". */
  role: text("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: uuid("impersonated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
)

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    /** Subject at the provider (`sub` for OIDC, user id for credentials). */
    accountId: text("account_id").notNull(),
    /** "credential" for email+password, "oidc" for SSO. */
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("auth_accounts_provider_account_uq").on(t.providerId, t.accountId), index("auth_accounts_user_idx").on(t.userId)],
)

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
)

export const rateLimits = pgTable("rate_limits", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
})

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

export const householdRole = pgEnum("household_role", ["owner", "admin", "member"])
export type HouseholdRole = (typeof householdRole.enumValues)[number]

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  /** ISO 4217 base currency for budgets and reports. */
  currency: text("currency").notNull().default("RUB"),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const householdMembers = pgTable(
  "household_members",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: householdRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] }), index("household_members_user_idx").on(t.userId)],
)

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** SHA-256 of the one-time token; the token itself is shown only once. */
    tokenHash: text("token_hash").notNull().unique(),
    role: householdRole("role").notNull().default("member"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_household_idx").on(t.householdId), check("invitations_role_ck", sql`${t.role} <> 'owner'`)],
)

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export const accountKind = pgEnum("financial_account_kind", ["cash", "debit_card", "credit_card", "savings", "shared", "other"])
export type AccountKind = (typeof accountKind.enumValues)[number]

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: accountKind("kind").notNull().default("debit_card"),
    currency: text("currency").notNull().default("RUB"),
    /** Balance at the moment tracking started; negative for credit card debt. */
    openingBalance: money("opening_balance").notNull().default(0),
    version: integer("version").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Target for composite foreign keys that guarantee same-household references.
    unique("financial_accounts_household_id_uq").on(t.householdId, t.id),
  ],
)

export const categoryKind = pgEnum("category_kind", ["income", "expense"])
export type CategoryKind = (typeof categoryKind.enumValues)[number]

export const categories = pgTable(
  "categories",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull().default("circle"),
    color: text("color").notNull().default("#64748b"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("categories_household_id_uq").on(t.householdId, t.id),
    uniqueIndex("categories_active_name_uq")
      .on(t.householdId, t.kind, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
)

export const transactionType = pgEnum("transaction_type", ["income", "expense", "transfer"])
export type TransactionType = (typeof transactionType.enumValues)[number]

export const transactionStatus = pgEnum("transaction_status", ["planned", "posted", "skipped"])
export type TransactionStatus = (typeof transactionStatus.enumValues)[number]

export const frequency = pgEnum("recurrence_frequency", ["once", "daily", "weekly", "monthly", "yearly"])
export type Frequency = (typeof frequency.enumValues)[number]

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    type: transactionType("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    amount: money("amount").notNull(),
    toAmount: money("to_amount"),
    categoryId: uuid("category_id"),
    accountId: uuid("account_id").notNull(),
    toAccountId: uuid("to_account_id"),
    frequency: frequency("frequency").notNull(),
    /** Every N days/weeks/months/years. */
    interval: smallint("interval").notNull().default(1),
    /** Day of month (1–31) for monthly/yearly rules; clamped to the month length. */
    dayOfMonth: smallint("day_of_month"),
    /** Anchor of the schedule (weekday for weekly, month for yearly). */
    startDate: date("start_date", { mode: "string" }).notNull(),
    /** Inclusive; null means open-ended. */
    endDate: date("end_date", { mode: "string" }),
    /** Occurrences before this date are never generated (rule creation / last edit point). */
    generateFrom: date("generate_from", { mode: "string" }).notNull(),
    /** Planned transactions exist for all occurrences up to and including this date. */
    materializedThrough: date("materialized_through", { mode: "string" }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("recurring_rules_household_id_uq").on(t.householdId, t.id),
    index("recurring_rules_household_idx").on(t.householdId),
    foreignKey({
      name: "recurring_rules_category_fk",
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }),
    foreignKey({
      name: "recurring_rules_account_fk",
      columns: [t.householdId, t.accountId],
      foreignColumns: [financialAccounts.householdId, financialAccounts.id],
    }),
    foreignKey({
      name: "recurring_rules_to_account_fk",
      columns: [t.householdId, t.toAccountId],
      foreignColumns: [financialAccounts.householdId, financialAccounts.id],
    }),
    check("recurring_rules_to_amount_ck", sql`${t.toAmount} is null or (${t.type} = 'transfer' and ${t.toAmount} > 0)`),
    check("recurring_rules_amount_ck", sql`${t.amount} > 0`),
    check("recurring_rules_interval_ck", sql`${t.interval} between 1 and 366`),
    check("recurring_rules_day_ck", sql`${t.dayOfMonth} is null or ${t.dayOfMonth} between 1 and 31`),
    check("recurring_rules_dates_ck", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check(
      "recurring_rules_transfer_ck",
      sql`(${t.type} = 'transfer') = (${t.toAccountId} is not null) and (${t.toAccountId} is null or ${t.toAccountId} <> ${t.accountId})`,
    ),
    check("recurring_rules_category_ck", sql`${t.type} = 'transfer' or ${t.categoryId} is not null`),
  ],
)

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    type: transactionType("type").notNull(),
    status: transactionStatus("status").notNull(),
    amount: money("amount").notNull(),
    toAmount: money("to_amount"),
    title: text("title").notNull(),
    description: text("description"),
    /** Effective date (actual or rescheduled). */
    date: date("date", { mode: "string" }).notNull(),
    categoryId: uuid("category_id"),
    accountId: uuid("account_id").notNull(),
    toAccountId: uuid("to_account_id"),
    recurringRuleId: uuid("recurring_rule_id"),
    /** Original schedule slot; stays fixed when the occurrence is moved, which keeps generation idempotent. */
    occurrenceDate: date("occurrence_date", { mode: "string" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("transactions_occurrence_uq").on(t.recurringRuleId, t.occurrenceDate),
    index("transactions_household_date_idx").on(t.householdId, t.date),
    index("transactions_household_status_date_idx").on(t.householdId, t.status, t.date),
    index("transactions_account_idx").on(t.accountId),
    index("transactions_to_account_idx").on(t.toAccountId),
    index("transactions_category_idx").on(t.categoryId),
    foreignKey({
      name: "transactions_category_fk",
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }),
    foreignKey({
      name: "transactions_account_fk",
      columns: [t.householdId, t.accountId],
      foreignColumns: [financialAccounts.householdId, financialAccounts.id],
    }),
    foreignKey({
      name: "transactions_to_account_fk",
      columns: [t.householdId, t.toAccountId],
      foreignColumns: [financialAccounts.householdId, financialAccounts.id],
    }),
    foreignKey({
      name: "transactions_rule_fk",
      columns: [t.recurringRuleId],
      foreignColumns: [recurringRules.id],
    }).onDelete("set null"),
    check("transactions_to_amount_ck", sql`${t.toAmount} is null or (${t.type} = 'transfer' and ${t.toAmount} > 0)`),
    check("transactions_amount_ck", sql`${t.amount} > 0`),
    check(
      "transactions_transfer_ck",
      sql`(${t.type} = 'transfer') = (${t.toAccountId} is not null) and (${t.toAccountId} is null or ${t.toAccountId} <> ${t.accountId})`,
    ),
    check("transactions_category_ck", sql`${t.type} = 'transfer' or ${t.categoryId} is not null`),
    check("transactions_occurrence_ck", sql`(${t.recurringRuleId} is null) or (${t.occurrenceDate} is not null)`),
  ],
)

/** Global public exchange rates: RUB per one major currency unit. */
export const exchangeRateSource = pgEnum("exchange_rate_source", ["cbr", "manual"])
export const exchangeRates = pgTable("exchange_rates", {
  currency: text("currency").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  rateToRub: numeric("rate_to_rub", { precision: 20, scale: 10 }).notNull(),
  source: exchangeRateSource("source").notNull(),
}, (t) => [
  primaryKey({ columns: [t.currency, t.date, t.source] }),
  check("exchange_rates_positive_ck", sql`${t.rateToRub} > 0`),
])

/** Successful CBR queries also cache ranges with no publications, independently of rate rows. */
export const exchangeRateFetches = pgTable("exchange_rate_fetches", {
  currency: text("currency").notNull(),
  fromDate: date("from_date", { mode: "string" }).notNull(),
  toDate: date("to_date", { mode: "string" }).notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  /** Confirmed past/current ranges are permanent; not-yet-arrived dates expire. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.currency, t.fromDate, t.toDate] }),
  check("exchange_rate_fetches_range_ck", sql`${t.fromDate} <= ${t.toDate}`),
])

export const categoryBudgets = pgTable(
  "category_budgets",
  {
    id: id(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull(),
    /** Monthly limit in minor units. */
    amount: money("amount").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("category_budgets_category_uq").on(t.householdId, t.categoryId),
    foreignKey({
      name: "category_budgets_category_fk",
      columns: [t.householdId, t.categoryId],
      foreignColumns: [categories.householdId, categories.id],
    }).onDelete("cascade"),
    check("category_budgets_amount_ck", sql`${t.amount} > 0`),
  ],
)

// ---------------------------------------------------------------------------
// Application settings, audit
// ---------------------------------------------------------------------------

export const applicationSettings = pgTable("application_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
})

export const oidcProviderSettings = pgTable(
  "oidc_provider_settings",
  {
    /** Singleton row: only one OIDC provider is supported. */
    id: smallint("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(false),
    displayName: text("display_name").notNull().default("SSO"),
    issuerUrl: text("issuer_url").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEncrypted: text("client_secret_encrypted"),
    scopes: text("scopes").notNull().default("openid profile email"),
    redirectUri: text("redirect_uri"),
    allowSignup: boolean("allow_signup").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [check("oidc_provider_settings_singleton_ck", sql`${t.id} = 1`)],
)

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    /** Changed fields etc. Never contains secrets. */
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_household_idx").on(t.householdId, t.createdAt), index("audit_logs_created_idx").on(t.createdAt)],
)

// ---------------------------------------------------------------------------
// Relations (for the relational query API)
// ---------------------------------------------------------------------------

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  user: one(users, { fields: [householdMembers.userId], references: [users.id] }),
  household: one(households, { fields: [householdMembers.householdId], references: [households.id] }),
}))

export type User = typeof users.$inferSelect
export type Household = typeof households.$inferSelect
export type FinancialAccount = typeof financialAccounts.$inferSelect
export type Category = typeof categories.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type RecurringRule = typeof recurringRules.$inferSelect
export type Invitation = typeof invitations.$inferSelect

// ---------------------------------------------------------------------------
// Notifications (opt-in per household; transport credentials are encrypted)
// ---------------------------------------------------------------------------

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").notNull(),
  householdId: uuid("household_id").notNull(),
  telegram: boolean("telegram").notNull().default(false),
  push: boolean("push").notNull().default(false),
  due: boolean("due").notNull().default(true),
  overdue: boolean("overdue").notNull().default(true),
  cashGap: boolean("cash_gap").notNull().default(true),
  budget: boolean("budget").notNull().default(true),
  daysBefore: smallint("days_before").notNull().default(1),
  budgetThreshold: smallint("budget_threshold").notNull().default(15),
  digest: boolean("digest").notNull().default(false),
  digestTime: text("digest_time").notNull().default("09:00"),
  quietStart: text("quiet_start").notNull().default("22:00"),
  quietEnd: text("quiet_end").notNull().default("08:00"),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.householdId] }),
  foreignKey({ columns: [t.householdId, t.userId], foreignColumns: [householdMembers.householdId, householdMembers.userId] }).onDelete("cascade"),
  check("notification_preferences_days_ck", sql`${t.daysBefore} between 0 and 30`),
  check("notification_preferences_threshold_ck", sql`${t.budgetThreshold} between 0 and 500`),
])

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: id(),
  userId: uuid("user_id").notNull(),
  householdId: uuid("household_id").notNull(),
  channel: text("channel").notNull(),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  budgetKeys: jsonb("budget_keys").$type<string[]>().notNull().default([]),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: text("status").notNull().default("sending"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(1),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique("notification_deliveries_dedupe_uq").on(t.userId, t.channel, t.dedupeKey),
  foreignKey({ columns: [t.householdId, t.userId], foreignColumns: [householdMembers.householdId, householdMembers.userId] }).onDelete("cascade"),
  index("notification_deliveries_created_idx").on(t.createdAt),
])

export const telegramLinks = pgTable("telegram_links", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  chatId: text("chat_id").unique(),
  tokenHash: text("token_hash").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
})

export const telegramUpdates = pgTable("telegram_updates", {
  key: text("key").primaryKey(),
  createdAt: createdAt(),
})

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  /** Encrypted shared subscription secret; p256dh is a public key. */
  auth: text("auth").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("push_subscriptions_user_idx").on(t.userId)])

export const notificationSettings = pgTable("notification_settings", {
  id: smallint("id").primaryKey().default(1),
  botTokenEncrypted: text("bot_token_encrypted"),
  mode: text("mode").notNull().default("polling"),
  botUsername: text("bot_username"),
  botId: text("bot_id"),
  updateOffset: bigint("update_offset", { mode: "number" }).notNull().default(0),
  lastUpdateAt: timestamp("last_update_at", { withTimezone: true }),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  transportFingerprint: text("transport_fingerprint"),
  transportError: text("transport_error"),
  vapidPublicKey: text("vapid_public_key"),
  vapidPrivateKeyEncrypted: text("vapid_private_key_encrypted"),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
}, (t) => [check("notification_settings_singleton_ck", sql`${t.id} = 1`)])
