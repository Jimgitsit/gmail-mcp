import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const TOKEN_DIR = join(homedir(), ".config", "gmail-mcp");
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

export function loadOAuthCredentials(): OAuthCredentials {
  const credsPath = join(TOKEN_DIR, "credentials.json");
  if (!existsSync(credsPath)) {
    throw new Error(
      `OAuth credentials not found at ${credsPath}. ` +
      `Download credentials.json from Google Cloud Console and place it there.`
    );
  }
  const raw = JSON.parse(readFileSync(credsPath, "utf-8"));
  const creds = raw.installed || raw.web;
  if (!creds) throw new Error("Invalid credentials.json format");
  return creds;
}

export function makeOAuthClient(creds: OAuthCredentials): OAuth2Client {
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:58009/oauth/callback"
  );
}

export function listAccounts(): string[] {
  if (!existsSync(TOKEN_DIR)) return [];
  return readdirSync(TOKEN_DIR)
    .filter((f) => f.endsWith(".token.json"))
    .map((f) => f.replace(".token.json", "").replace(/_at_/g, "@").replace(/_dot_/g, "."));
}

function emailToFilename(email: string): string {
  return email.replace(/@/g, "_at_").replace(/\./g, "_dot_") + ".token.json";
}

export function loadToken(email: string): OAuth2Client | null {
  const tokenPath = join(TOKEN_DIR, emailToFilename(email));
  if (!existsSync(tokenPath)) return null;
  const creds = loadOAuthCredentials();
  const client = makeOAuthClient(creds);
  client.setCredentials(JSON.parse(readFileSync(tokenPath, "utf-8")));
  return client;
}

export function saveToken(email: string, client: OAuth2Client): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  const tokenPath = join(TOKEN_DIR, emailToFilename(email));
  writeFileSync(tokenPath, JSON.stringify(client.credentials, null, 2));
}

export function removeToken(email: string): boolean {
  const tokenPath = join(TOKEN_DIR, emailToFilename(email));
  if (!existsSync(tokenPath)) return false;
  const { unlinkSync } = require("fs");
  unlinkSync(tokenPath);
  return true;
}

export async function runOAuthFlow(email?: string): Promise<string> {
  const creds = loadOAuthCredentials();
  const client = makeOAuthClient(creds);

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    login_hint: email,
    prompt: "consent",
  });

  console.error(`\nOpen this URL to authorize:\n\n${authUrl}\n`);

  // Try to launch the user's default browser (macOS). Failure is non-fatal —
  // the URL is also logged above for manual paste.
  Bun.$`open ${authUrl}`.quiet().nothrow();

  // Spin up a temporary local server to capture the callback
  const code = await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      server.close();
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url!, "http://localhost");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        res.end("Authorization failed: " + error);
        cleanup();
        reject(new Error("OAuth error: " + error));
        return;
      }
      if (code) {
        res.end("<html><body><h2>Authorized! You can close this tab.</h2></body></html>");
        cleanup();
        resolve(code);
        return;
      }
      res.end();
    });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("OAuth flow timed out after 5 minutes"));
    }, 5 * 60 * 1000);
    server.listen(58009, () => {
      console.error("Waiting for OAuth callback on port 58009...");
    });
    server.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Resolve the actual email if not provided
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const resolvedEmail = profile.data.emailAddress!;

  saveToken(resolvedEmail, client);
  return resolvedEmail;
}

export function getAuthClient(email: string): OAuth2Client {
  const client = loadToken(email);
  if (!client) {
    throw new Error(
      `Account ${email} not authorized. Use add_account tool or run with --add-account.`
    );
  }
  return client;
}
