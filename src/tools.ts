import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listAccounts,
  runOAuthFlow,
  removeToken,
  getAuthClient,
} from "./auth.js";
import {
  makeGmailClient,
  searchThreads,
  getThread,
  getMessage,
  sendEmail,
  createDraft,
  listDrafts,
  deleteDraft,
  listLabels,
  createLabel,
  applyLabel,
} from "./gmail.js";

function resolveAccount(account?: string): string {
  if (account) return account;
  const accounts = listAccounts();
  if (accounts.length === 0) throw new Error("No accounts configured. Use add_account first.");
  return accounts[0];
}

export function registerTools(server: McpServer): void {
  // Account management
  server.tool("list_accounts", "List all authorized Gmail accounts", {}, async () => {
    const accounts = listAccounts();
    return {
      content: [{ type: "text", text: accounts.length === 0
        ? "No accounts configured."
        : accounts.map((a, i) => `${i + 1}. ${a}${i === 0 ? " (default)" : ""}`).join("\n")
      }],
    };
  });

  server.tool(
    "add_account",
    "Authorize a new Gmail account via OAuth. Opens a browser flow.",
    { email: z.string().email().optional().describe("Hint for which account to use") },
    async ({ email }) => {
      const resolvedEmail = await runOAuthFlow(email);
      return { content: [{ type: "text", text: `Authorized: ${resolvedEmail}` }] };
    }
  );

  server.tool(
    "remove_account",
    "Remove a Gmail account's authorization",
    { account: z.string().email().describe("Account email to remove") },
    async ({ account }) => {
      const removed = removeToken(account);
      return { content: [{ type: "text", text: removed ? `Removed: ${account}` : `Not found: ${account}` }] };
    }
  );

  // Search
  server.tool(
    "search_threads",
    "Search Gmail threads using Gmail query syntax (e.g. 'from:foo@bar.com is:unread')",
    {
      query: z.string().describe("Gmail search query"),
      max_results: z.number().int().min(1).max(100).default(20).describe("Max threads to return"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ query, max_results, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const threads = await searchThreads(gmail, query, max_results);
      const text = threads.length === 0
        ? "No threads found."
        : threads.map((t) => `Thread ${t.threadId}: ${t.snippet}`).join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  // Get thread
  server.tool(
    "get_thread",
    "Get all messages in a Gmail thread",
    {
      thread_id: z.string().describe("Thread ID"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ thread_id, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const thread = await getThread(gmail, thread_id);
      const text = thread.messages.map((m) =>
        `--- Message ${m.id} ---\nFrom: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\nLabels: ${m.labelIds.join(", ")}\n\n${m.body}`
      ).join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  // Get single message
  server.tool(
    "get_message",
    "Get a single Gmail message by ID",
    {
      message_id: z.string().describe("Message ID"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ message_id, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const msg = await getMessage(gmail, message_id);
      const text = `From: ${msg.from}\nTo: ${msg.to}\nDate: ${msg.date}\nSubject: ${msg.subject}\nLabels: ${msg.labelIds.join(", ")}\n\n${msg.body}`;
      return { content: [{ type: "text", text }] };
    }
  );

  // Send email
  server.tool(
    "send_email",
    "Send an email from a Gmail account",
    {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body. Plain text, or HTML when it starts with <!doctype html> or <html> (sent as text/html). No attachments."),
      cc: z.string().optional().describe("CC addresses (comma-separated)"),
      reply_to_message_id: z.string().optional().describe("Message ID to reply to"),
      reply_to_thread_id: z.string().optional().describe("Thread ID to reply into"),
      account: z.string().email().optional().describe("Gmail account to send from (defaults to first)"),
      from_name: z.string().optional().describe("Display name to show as sender (e.g., 'The Desk'). Falls back to the bare email address if omitted."),
    },
    async ({ to, subject, body, cc, reply_to_message_id, reply_to_thread_id, account, from_name }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const messageId = await sendEmail(gmail, email, {
        to,
        subject,
        body,
        cc,
        replyToMessageId: reply_to_message_id,
        replyToThreadId: reply_to_thread_id,
        fromName: from_name,
      });
      return { content: [{ type: "text", text: `Sent. Message ID: ${messageId}` }] };
    }
  );

  // Draft management
  server.tool(
    "create_draft",
    "Create a Gmail draft",
    {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body. Plain text, or HTML when it starts with <!doctype html> or <html> (sent as text/html). No attachments."),
      reply_to_thread_id: z.string().optional().describe("Thread ID to draft a reply into"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ to, subject, body, reply_to_thread_id, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const draftId = await createDraft(gmail, email, { to, subject, body, replyToThreadId: reply_to_thread_id });
      return { content: [{ type: "text", text: `Draft created. Draft ID: ${draftId}` }] };
    }
  );

  server.tool(
    "list_drafts",
    "List Gmail drafts",
    {
      max_results: z.number().int().min(1).max(100).default(20),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ max_results, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const drafts = await listDrafts(gmail, max_results);
      const text = drafts.length === 0
        ? "No drafts."
        : drafts.map((d) => `Draft ${d.draftId} (msg: ${d.messageId}): ${d.snippet}`).join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "delete_draft",
    "Delete a Gmail draft",
    {
      draft_id: z.string().describe("Draft ID to delete"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ draft_id, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      await deleteDraft(gmail, draft_id);
      return { content: [{ type: "text", text: `Draft ${draft_id} deleted.` }] };
    }
  );

  // Labels
  server.tool(
    "list_labels",
    "List all Gmail labels",
    { account: z.string().email().optional().describe("Gmail account to use (defaults to first)") },
    async ({ account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const labels = await listLabels(gmail);
      const text = labels.map((l) => `${l.id} | ${l.name} (${l.type})`).join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "create_label",
    "Create a new Gmail label",
    {
      name: z.string().describe("Label name"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ name, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      const label = await createLabel(gmail, name);
      return { content: [{ type: "text", text: `Created label: ${label.name} (ID: ${label.id})` }] };
    }
  );

  server.tool(
    "apply_labels",
    "Add or remove labels on a Gmail message",
    {
      message_id: z.string().describe("Message ID"),
      add_label_ids: z.array(z.string()).default([]).describe("Label IDs to add"),
      remove_label_ids: z.array(z.string()).default([]).describe("Label IDs to remove"),
      account: z.string().email().optional().describe("Gmail account to use (defaults to first)"),
    },
    async ({ message_id, add_label_ids, remove_label_ids, account }) => {
      const email = resolveAccount(account);
      const gmail = makeGmailClient(getAuthClient(email));
      await applyLabel(gmail, message_id, add_label_ids, remove_label_ids);
      return { content: [{ type: "text", text: `Labels updated on message ${message_id}.` }] };
    }
  );
}
