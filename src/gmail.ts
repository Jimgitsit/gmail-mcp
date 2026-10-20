import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { gmail_v1 } from "googleapis";

export type GmailClient = gmail_v1.Gmail;

export function makeGmailClient(auth: OAuth2Client): GmailClient {
  return google.gmail({ version: "v1", auth });
}

export interface Message {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  labelIds: string[];
}

export interface Thread {
  id: string;
  messages: Message[];
}

function decodeBody(parts: gmail_v1.Schema$MessagePart[] | undefined, mimeType: string): string {
  if (!parts) return "";
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.parts) {
      const nested = decodeBody(part.parts, mimeType);
      if (nested) return nested;
    }
  }
  return "";
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseMessage(raw: gmail_v1.Schema$Message): Message {
  const headers = raw.payload?.headers ?? [];
  let body = "";
  if (raw.payload?.body?.data) {
    body = Buffer.from(raw.payload.body.data, "base64").toString("utf-8");
  } else {
    body = decodeBody(raw.payload?.parts, "text/plain") ||
           decodeBody(raw.payload?.parts, "text/html");
  }

  return {
    id: raw.id!,
    threadId: raw.threadId!,
    subject: getHeader(headers, "subject"),
    from: getHeader(headers, "from"),
    to: getHeader(headers, "to"),
    date: getHeader(headers, "date"),
    snippet: raw.snippet ?? "",
    body,
    labelIds: raw.labelIds ?? [],
  };
}

export async function searchThreads(
  gmail: GmailClient,
  query: string,
  maxResults = 20
): Promise<{ threadId: string; snippet: string }[]> {
  const res = await gmail.users.threads.list({
    userId: "me",
    q: query,
    maxResults,
  });
  return (res.data.threads ?? []).map((t) => ({
    threadId: t.id!,
    snippet: t.snippet ?? "",
  }));
}

export async function getThread(gmail: GmailClient, threadId: string): Promise<Thread> {
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  return {
    id: res.data.id!,
    messages: (res.data.messages ?? []).map(parseMessage),
  };
}

export async function getMessage(gmail: GmailClient, messageId: string): Promise<Message> {
  const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
  return parseMessage(res.data);
}

export interface SendOptions {
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
  replyToThreadId?: string;
  cc?: string;
  bcc?: string;
  fromName?: string;
  // Extra raw headers, e.g. List-Unsubscribe / List-Unsubscribe-Post (RFC 8058). Values must be ASCII.
  headers?: Record<string, string>;
}

function isHtmlBody(body: string): boolean {
  const trimmed = body.trimStart().slice(0, 200).toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

// RFC 2047: header values must be ASCII. Anything else (an em dash, an accented
// name) goes out as a UTF-8 base64 "encoded word", or Gmail reads the raw bytes
// as Latin-1 and the subject renders as mojibake ("Ã¢Â€Â”").
export function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatFromHeader(email: string, displayName?: string): string {
  if (!displayName) return email;
  if (!/^[\x20-\x7e]*$/.test(displayName)) {
    return `${encodeHeaderWord(displayName)} <${email}>`;
  }
  const escaped = displayName.replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}

function buildRawEmail(from: string, opts: SendOptions, extraHeaders: string[] = []): string {
  const contentType = isHtmlBody(opts.body)
    ? "text/html; charset=utf-8"
    : "text/plain; charset=utf-8";
  const headers = [
    `From: ${formatFromHeader(from, opts.fromName)}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}`,
    ...extraHeaders,
    ...Object.entries(opts.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
  ].join("\r\n");
  return Buffer.from(`${headers}\r\n\r\n${opts.body}`).toString("base64url");
}

export async function sendEmail(
  gmail: GmailClient,
  fromEmail: string,
  opts: SendOptions
): Promise<string> {
  const extraHeaders: string[] = [];
  if (opts.cc) extraHeaders.push(`Cc: ${opts.cc}`);
  if (opts.bcc) extraHeaders.push(`Bcc: ${opts.bcc}`);
  if (opts.replyToMessageId) {
    extraHeaders.push(`In-Reply-To: <${opts.replyToMessageId}>`);
    extraHeaders.push(`References: <${opts.replyToMessageId}>`);
  }

  const raw = buildRawEmail(fromEmail, opts, extraHeaders);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: opts.replyToThreadId,
    },
  });
  return res.data.id!;
}

export async function createDraft(
  gmail: GmailClient,
  fromEmail: string,
  opts: SendOptions
): Promise<string> {
  const raw = buildRawEmail(fromEmail, opts);
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId: opts.replyToThreadId } },
  });
  return res.data.id!;
}

export async function listDrafts(
  gmail: GmailClient,
  maxResults = 20
): Promise<{ draftId: string; messageId: string; snippet: string }[]> {
  const res = await gmail.users.drafts.list({ userId: "me", maxResults });
  const drafts = res.data.drafts ?? [];
  return Promise.all(
    drafts.map(async (d) => {
      const detail = await gmail.users.drafts.get({ userId: "me", id: d.id!, format: "metadata" });
      return {
        draftId: d.id!,
        messageId: detail.data.message?.id ?? "",
        snippet: detail.data.message?.snippet ?? "",
      };
    })
  );
}

export async function deleteDraft(gmail: GmailClient, draftId: string): Promise<void> {
  await gmail.users.drafts.delete({ userId: "me", id: draftId });
}

export interface Label {
  id: string;
  name: string;
  type: string;
}

export async function listLabels(gmail: GmailClient): Promise<Label[]> {
  const res = await gmail.users.labels.list({ userId: "me" });
  return (res.data.labels ?? []).map((l) => ({
    id: l.id!,
    name: l.name!,
    type: l.type ?? "user",
  }));
}

export async function createLabel(gmail: GmailClient, name: string): Promise<Label> {
  const res = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  return { id: res.data.id!, name: res.data.name!, type: res.data.type ?? "user" };
}

export async function applyLabel(
  gmail: GmailClient,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[] = []
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds, removeLabelIds },
  });
}
