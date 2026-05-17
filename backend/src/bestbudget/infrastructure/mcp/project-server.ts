import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir =
  process.env.BESTBUDGET_ROOT ?? path.resolve(__dirname, "../../../../..")

const allowedFiles = new Map([
  ["project-task.md", "project-task.md"],
  ["README.md", "README.md"],
  ["openapi.yaml", "docs/openapi.yaml"],
  ["architecture.md", "docs/architecture.md"],
  ["component-inventory.md", "docs/component-inventory.md"],
])

async function readProjectFile(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const requested = allowedFiles.get(normalized) ?? normalized
  const absolutePath = path.resolve(rootDir, requested)

  if (!absolutePath.startsWith(path.resolve(rootDir))) {
    throw new Error("Requested file is outside the BestBudget repository")
  }

  const isAllowed = [...allowedFiles.values()].some(
    (allowed) => path.resolve(rootDir, allowed) === absolutePath
  )

  if (!isAllowed) {
    throw new Error(
      `File is not exposed by this MCP server. Allowed: ${[
        ...allowedFiles.keys(),
      ].join(", ")}`
    )
  }

  return readFile(absolutePath, "utf8")
}

const server = new McpServer({
  name: "bestbudget-project",
  version: "0.1.0",
})

server.resource("project-task", "bestbudget://project-task", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/markdown",
      text: await readProjectFile("project-task.md"),
    },
  ],
}))

server.resource("openapi", "bestbudget://openapi", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "application/yaml",
      text: await readProjectFile("openapi.yaml"),
    },
  ],
}))

server.tool(
  "summarize_mvp_scope",
  "Return the current MVP scope and technical baseline from the project task.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: [
          "BestBudget MVP baseline:",
          "- Web-first PWA with React, TypeScript, Vite, and a separate Node/TypeScript backend.",
          "- Backend structure follows Cleanarr-style layering: api, application, domain, infrastructure.",
          "- PostgreSQL primary database with household-aware schema and future RLS hardening.",
          "- shadcn/ui for critical UI primitives; React Bits only for non-critical decorative/overview blocks.",
          "- MVP domain: SSO shell, households, accounts, transactions, budgets, salary allocations, liabilities, PDF documents, calendar, reports, CSV import/export, audit.",
          "- Integrations prepared but not fully enabled: OCR adapter, Google Calendar, push/email, open banking read-only pilot.",
        ].join("\n"),
      },
    ],
  })
)

server.tool(
  "read_project_file",
  "Read a whitelisted BestBudget planning file exposed through this MCP server.",
  {
    relativePath: z
      .string()
      .describe("One of: project-task.md, README.md, openapi.yaml, architecture.md, component-inventory.md"),
  },
  async ({ relativePath }) => ({
    content: [
      {
        type: "text",
        text: await readProjectFile(relativePath),
      },
    ],
  })
)

const transport = new StdioServerTransport()
await server.connect(transport)
