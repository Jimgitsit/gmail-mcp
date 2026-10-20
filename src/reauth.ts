// Re-authorize an account without the localhost:58009 listener (that port is
// now held by another launchd app). Two steps:
//   bun src/reauth.ts url <email> [send|campaign]   → prints the auth URL to open
//   bun src/reauth.ts code <email> <redirect URL or bare code>
// The redirect URL Google sends the browser to will fail to load; paste it in.
//
// `send` requests ONLY gmail.send. Why: the app is unverified and In production.
// gmail.readonly/modify/compose are *restricted* scopes, which Google blocks
// outright for unverified production apps (error=access_denied). gmail.send is
// merely *sensitive*: Google shows "Google hasn't verified this app", and the
// user can proceed via Advanced → "Go to gmail-mcp (unsafe)". A send-only token
// can send but cannot read, list drafts, or label for that account.

import { google } from "googleapis";
import { loadOAuthCredentials, makeOAuthClient, saveToken } from "./auth";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

const [mode, email, arg] = process.argv.slice(2);
// Send-only also asks for openid+email (not sensitive) so the id_token names the
// account: users.getProfile needs a read scope, which a send-only token lacks.
const SEND_ONLY = ["https://www.googleapis.com/auth/gmail.send", "openid", "https://www.googleapis.com/auth/userinfo.email"];
// `campaign` = send-only plus Google Sheets (sensitive, not restricted, so the same
// "unsafe" click-through works) for the outreach tracking sheet.
const CAMPAIGN = [...SEND_ONLY, "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/gmail.modify"];
const scopes = mode === "url" && arg === "send" ? SEND_ONLY : mode === "url" && arg === "campaign" ? CAMPAIGN : SCOPES;
if (!mode || !email) {
  console.error("usage: reauth.ts url <email> | code <email> <redirect-url-or-code>");
  process.exit(2);
}

const client = makeOAuthClient(loadOAuthCredentials());

if (mode === "url") {
  console.log(client.generateAuthUrl({ access_type: "offline", scope: scopes, login_hint: email, prompt: "consent" }));
} else if (mode === "code") {
  if (!arg) {
    console.error("missing code");
    process.exit(2);
  }
  let code = arg;
  if (arg.startsWith("http")) {
    const c = new URL(arg).searchParams.get("code");
    if (!c) {
      console.error("no code= in that URL");
      process.exit(1);
    }
    code = c;
  }
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (e: any) {
    const d = e?.response?.data;
    console.error("token exchange failed:", d ? JSON.stringify(d) : e?.message ?? e);
    process.exit(1);
  }
  client.setCredentials(tokens);
  let resolved: string;
  if (tokens.id_token) {
    const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString("utf8"));
    resolved = payload.email;
  } else {
    const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
    resolved = profile.data.emailAddress!;
  }
  if (resolved !== email) {
    console.error(`signed in as ${resolved}, expected ${email}; not saving`);
    process.exit(1);
  }
  saveToken(resolved, client);
  console.log(`saved token for ${resolved}`);
} else {
  console.error("unknown mode");
  process.exit(2);
}
