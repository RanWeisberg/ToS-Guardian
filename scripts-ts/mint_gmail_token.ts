/**
 * scripts-ts/mint_gmail_token.ts — one-time Gmail OAuth helper (STANDALONE).
 *
 * NOT part of the app. This is a local, run-once utility that performs the Google
 * OAuth "installed/web app" authorization-code flow to obtain a long-lived Gmail
 * REFRESH TOKEN for the dedicated demo account. The Phase 6b Gmail MailSource will
 * use that refresh token (via GMAIL_REFRESH_TOKEN) to poll the mailbox headlessly.
 *
 * It reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from the environment and uses the
 * fixed redirect URI http://localhost:3000/oauth2callback (which must be registered
 * on the OAuth client in the Google Cloud console).
 *
 * It NEVER prints the client secret and NEVER writes any file — it only prints the
 * refresh token so you can paste it into .env.local yourself.
 *
 * Run with:  npx tsx --env-file=.env.local scripts-ts/mint_gmail_token.ts
 */

import http from "node:http";
import { google } from "googleapis";

// The OAuth client must have this EXACT redirect URI registered in Google Cloud.
const REDIRECT_HOST = "localhost";
const REDIRECT_PORT = 3000;
const REDIRECT_PATH = "/oauth2callback";
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;

// Read-only Gmail — matches the scope configured for this project.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. Set it in .env.local and re-run with ` +
        `\`npx tsx --env-file=.env.local scripts-ts/mint_gmail_token.ts\`.`,
    );
  }
  return value;
}

/** Wait for the single OAuth redirect and resolve with the authorization code. */
function waitForCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Ignore anything that isn't the callback path (e.g. favicon.ico).
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const oauthError = url.searchParams.get("error");

      if (oauthError) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Authorization failed: ${oauthError}. You can close this tab.`);
        server.close();
        reject(new Error(`Google returned an error: ${oauthError}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("No authorization code in the redirect. You can close this tab.");
        server.close();
        reject(new Error("Redirect arrived without a ?code= parameter."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body style=\"font-family:sans-serif\">" +
          "<h2>✅ Authorization received</h2>" +
          "<p>You can close this tab and return to the terminal.</p>" +
          "</body></html>",
      );
      server.close();
      resolve(code);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${REDIRECT_PORT} is already in use (is \`next dev\` running?). ` +
              `Stop whatever is on :${REDIRECT_PORT} and re-run this script.`,
          ),
        );
      } else {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, REDIRECT_HOST, () => {
      console.log(`\nWaiting for the Google redirect on ${REDIRECT_URI} …`);
    });
  });
}

async function main() {
  const clientId = requireEnv("GMAIL_CLIENT_ID");
  const clientSecret = requireEnv("GMAIL_CLIENT_SECRET"); // never printed

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline", // ask Google to return a refresh token
    prompt: "consent", // force the consent screen so a refresh token is always reissued
    scope: SCOPES,
  });

  console.log("\n=== Gmail refresh-token minting ===\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(authUrl);
  console.log(
    "\n2. Sign in as the DEDICATED demo Gmail account and approve the read-only access.",
  );
  console.log(
    "   You'll be redirected back to localhost:3000 automatically — leave this running.\n",
  );

  const code = await waitForCode();

  console.log("\nGot the authorization code. Exchanging it for tokens …");
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "\n⚠️  No refresh_token came back.\n" +
        "This usually means Google skipped the consent screen (a refresh token is only " +
        "issued on fresh consent). Re-run this script — `prompt: 'consent'` should force " +
        "it. If it keeps happening, revoke the app's access at " +
        "https://myaccount.google.com/permissions and try again.",
    );
    process.exit(1);
  }

  console.log("\n=====================================================================");
  console.log("✅ SUCCESS — your Gmail refresh token (paste into .env.local):\n");
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("\n=====================================================================");
  console.log(
    "\nThis token is long-lived. Add the line above to .env.local (do NOT commit it).",
  );
  console.log("Nothing was written to disk automatically — that's up to you.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("\n!!! mint_gmail_token failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});