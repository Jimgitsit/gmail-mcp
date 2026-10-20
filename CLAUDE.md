# gmail-mcp

MCP server for multi-account Gmail access (search, read, send, drafts, labels).
Read [`wiki/projects/gmail-mcp.md`](../wiki/projects/gmail-mcp.md) before working here.

## Tripwires

- **Don't call the `add_account` MCP tool when the user isn't at this machine** — its
  OAuth callback hits localhost on whichever box the browser is on. Use the remote
  procedure in the [project page](../wiki/projects/gmail-mcp.md#adding-an-account-when-the-user-is-remote).
- **Tokens here are load-bearing elsewhere.** [traffic-monitor](../wiki/projects/traffic-monitor.md)
  imports this project's `src/auth.ts` and `src/gmail.ts` to send its daily report, so
  breaking the token layout breaks that too.

Bun API conventions: [`wiki/notes/bun-conventions.md`](../wiki/notes/bun-conventions.md).
