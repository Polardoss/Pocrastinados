// One-time setup script: authorizes this app against your Trakt account
// using the OAuth2 Device Code flow (no callback URL needed) and stores the
// resulting access/refresh token pair in Supabase (trakt_tokens). Run this
// once locally after registering a Trakt app; the cron job and dashboard
// take care of refreshing the token afterwards.
//
// Usage: npm run trakt:authorize

import { config } from "dotenv";
import { getSupabaseAdmin } from "../src/lib/supabase-admin";

config({ path: ".env.local" });
config();

const TRAKT_API_BASE = "https://api.trakt.tv";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(`${TRAKT_API_BASE}/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });

  if (!res.ok) {
    throw new Error(`Failed to request device code: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as DeviceCodeResponse;
}

async function pollForToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<TokenResponse> {
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);

    const res = await fetch(`${TRAKT_API_BASE}/oauth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: deviceCode,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (res.status === 200) {
      return (await res.json()) as TokenResponse;
    }

    // 400 = authorization pending, keep polling. Anything else is fatal.
    if (res.status !== 400) {
      throw new Error(`Device token polling failed: ${res.status} ${res.statusText}`);
    }
  }

  throw new Error("Device code expired before authorization completed. Run this script again.");
}

async function main() {
  const clientId = process.env.TRAKT_CLIENT_ID;
  const clientSecret = process.env.TRAKT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET in .env.local first.");
  }

  const device = await requestDeviceCode(clientId);

  console.log("\nTo authorize Pocrastinados with your Trakt account:");
  console.log(`  1. Open ${device.verification_url}`);
  console.log(`  2. Enter this code: ${device.user_code}\n`);
  console.log("Waiting for authorization...");

  const tokens = await pollForToken(
    clientId,
    clientSecret,
    device.device_code,
    device.interval,
    device.expires_in
  );

  const supabase = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error } = await supabase.from("trakt_tokens").upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to store tokens in Supabase: ${error.message}`);
  }

  console.log("\nAuthorization successful — tokens stored in Supabase (trakt_tokens).");
  console.log("You can now run: npm run fetch:trakt");
}

main().catch((error) => {
  console.error("Trakt authorization failed:", error);
  process.exitCode = 1;
});
