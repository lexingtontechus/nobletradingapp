// =============================================================================
// Noble Trading App — Next.js API Route: GET /api/redis-credentials
// =============================================================================
// Returns the current user's active Redis credentials bundle (decrypted).
// Used by the portal's RedisCredentialsPanel to render the bash-like env-var
// text area.
//
//   GET /api/redis-credentials
//   → 200 {
//        subscriptionId, planName, planSlug,
//        redisUrl,         // rediss://<username>:<password>@<host>:<port>
//        redisUsername,
//        redisPassword,    // decrypted plaintext (server-side only; reaches
//                          // the browser via this HTTPS response)
//        streamName,       // e.g. "signals:signal_scout"
//        consumerGroup,    // equals redisUsername
//        apiKey,           // decrypted NTA API key (for future REST access)
//        rotatedAt,        // ISO timestamp of last rotation
//        passwordVersion,  // integer, bumps on rotation
//      }
//   → 404 if no active subscription or no non-revoked creds
//   → 401 if not signed in
//
// SECURITY:
//   - The password is decrypted server-side and sent to the browser over HTTPS.
//     This is the same trust model as Stripe / AWS / GitHub showing you your
//     API key in their dashboard.
//   - The browser should treat this response as sensitive (no caching — we
//     set Cache-Control: no-store).
//   - For added defense-in-depth, the panel hides the values behind a "Reveal"
//     button so they're not visible on screen-share.
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// -----------------------------------------------------------------------------
// AES-256-GCM decrypt via Web Crypto (matches the Edge Function's encrypt).
// Web Crypto's AES-GCM ciphertext has the 16-byte auth tag appended; we pass
// the whole blob to decrypt() and it splits internally.
// -----------------------------------------------------------------------------
async function decrypt(cipherB64: string, ivB64: string, keyB64: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const cipher = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

// Build the rediss:// URL the user pastes into their bot config.
// REDIS_PUBLIC_URL is the host:port subscribers connect to (may differ from
// the admin URL — e.g. a separate TLS endpoint or a load-balanced front).
function buildRedisUrl(username: string, password: string): string {
  const base = process.env.REDIS_PUBLIC_URL || "rediss://localhost:6379";
  const u = new URL(base);
  u.username = encodeURIComponent(username);
  u.password = encodeURIComponent(password);
  return u.toString();
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Resolve local user
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (!localUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 2. Fetch the most recent active/grace subscription + its non-revoked creds
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select(`
      id, status,
      plans(id, title, slug),
      redis_credentials(id, redis_username, password_cipher, password_iv,
                        password_version, api_key_cipher, api_key_iv,
                        stream_name, consumer_group, rotated_at, revoked_at)
    `)
    .eq("user_id", localUser.id)
    .in("status", ["active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !sub) {
    return NextResponse.json(
      { error: "No active subscription" },
      { status: 404 },
    );
  }

  // Find the non-revoked credential row (there should be exactly one).
  const creds = (sub.redis_credentials ?? []).find((c: any) => !c.revoked_at);
  if (!creds) {
    return NextResponse.json(
      { error: "Credentials not provisioned or revoked" },
      { status: 404 },
    );
  }

  // 3. Decrypt the password + API key
  const encryptionKey = process.env.REDIS_CRED_ENCRYPTION_KEY!;
  let password: string;
  let apiKey: string | null = null;
  try {
    password = await decrypt(creds.password_cipher, creds.password_iv, encryptionKey);
    if (creds.api_key_cipher && creds.api_key_iv) {
      apiKey = await decrypt(creds.api_key_cipher, creds.api_key_iv, encryptionKey);
    }
  } catch (e: any) {
    console.error("Redis credential decrypt failed:", e);
    return NextResponse.json(
      { error: "Failed to decrypt credentials (key mismatch?)" },
      { status: 500 },
    );
  }

  // 4. Build the bundle
  const bundle = {
    subscriptionId: sub.id,
    subscriptionStatus: sub.status,
    planName: sub.plans?.title ?? "Subscription",
    planSlug: sub.plans?.slug ?? null,
    redisUrl: buildRedisUrl(creds.redis_username, password),
    redisUsername: creds.redis_username,
    redisPassword: password,
    streamName: creds.stream_name,
    consumerGroup: creds.consumer_group,
    apiKey,
    rotatedAt: creds.rotated_at,
    passwordVersion: creds.password_version,
  };

  // no-store: never cache credentials in the browser or any CDN.
  return NextResponse.json(bundle, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
