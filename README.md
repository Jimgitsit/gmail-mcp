# gmail-mcp

MCP server for multi-account Gmail access. Exposes tools for search, read, send, drafts, and labels across any number of Gmail accounts.

## Setup

### 1. Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID — type: **Desktop app**
3. Download the JSON and save it to `~/.config/gmail-mcp/credentials.json`
4. Enable the **Gmail API** in your project

### 2. Add accounts

```bash
# Add first account (opens browser OAuth flow)
bun run add-account

# Add additional accounts
bun src/index.ts --add-account other@gmail.com
```

Tokens are stored in `~/.config/gmail-mcp/<email>.token.json`.

### 3. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "bun",
      "args": ["/Users/doug/dev-local/gmail-mcp/src/index.ts"]
    }
  }
}
```

Restart Claude Desktop.

## Tools

| Tool | Description |
|---|---|
| `list_accounts` | List authorized accounts |
| `add_account` | Authorize a new account (OAuth browser flow) |
| `remove_account` | Revoke an account |
| `search_threads` | Search with Gmail query syntax |
| `get_thread` | Fetch all messages in a thread |
| `get_message` | Fetch a single message |
| `send_email` | Send or reply to email |
| `create_draft` | Create a draft |
| `list_drafts` | List drafts |
| `delete_draft` | Delete a draft |
| `list_labels` | List all labels |
| `create_label` | Create a new label |
| `apply_labels` | Add/remove labels on a message |

All tools accept an optional `account` parameter (email address). Omit it to use the first registered account.

## Port usage

OAuth callback uses port **58009** (reserved in your dev-local port map for Web UIs).
