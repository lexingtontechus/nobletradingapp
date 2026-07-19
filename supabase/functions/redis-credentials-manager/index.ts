// =============================================================================
// Noble Trading App — Supabase Edge Function: redis-credentials-manager
// =============================================================================
// Internal-only operator that talks to Redis as an admin and provisions /
// revokes / rotates per-subscriber ACL users. Called by:
//   - helio-webhook (on STARTED/RENEWED → provision; on ENDED → revoke)
//   - /api/redis-credentials/rotate (user-initiated rotation)
//
// AUTH: shared internal secret in the `X-Internal-Secret` header. The webhook
// and the Next.js API route both pass it. NOT callable by anonymous clients.
//
// ACTIONS:
//   POST { action: 'provision', subscriptionId, userId, planId }
//     → idempotent. If an active (non-revoked) row exists, no-op.
//     → otherwise: ACL SETUSER on Redis + INSERT row (password_version=1).
//     → returns { ok, alreadyProvisioned?: true, provisioned?: true }
//
//   POST { action: 'revoke', subscriptionId }
//     → ACL DELUSER for every active row on this subscription.
//     → marks revoked_at on each row.
//     → returns { ok, revoked: <count> }
//
//   POST { action: 'rotate', subscriptionId }
//     → zero-downtime rotation: ACL SETUSER >newpwd (now both old+new work),
//       then ACL SETUSER <oldpwd (old instantly invalid).
//     → updates the row: new password_cipher, password_iv, password_version+1,
//       rotated_at=now().
//     → returns { ok, rotated: true, passwordVersion: <new> }
//
// ACL RULES (least-privilege — verified against Redis 6+ ACL docs):
//   on >password ~signals:*
//   +ping +hello +client
//   +xread +xreadgroup +xgroup +xack +xpending +xclaim
//   +xinfo +xlen +xrange +xrevrange
//
//   NOT granted (implicitly denied for new users): xadd, xtrim, del, flushdb,
//   flushall, config, acl, eval, all non-stream commands. The subscriber can
//   only READ from signal streams and manage their own consumer group.
//
// PASSWORD STORAGE:
//   - Generated as 32 chars from URL-safe alphabet (A-Za-z0-9-._~) — no +/=
//     so it can go in a rediss:// URL without encoding.
//   - AES-256-GCM encrypted via Web Crypto. Ciphertext includes the 16-byte
//     auth tag appended (Web Crypto convention). Base64 for storage.
//   - IV is 12 random bytes, base64.
//   - Key is 32 bytes, base64 in REDIS_CRED_ENCRYPTION_KEY env var.
// =============================================================================
// Env vars (set via: supabase secrets set ...):
//   REDIS_ADMIN_URL             — rediss://<admin>:<pwd>@<host>:<port> (TLS)
//   REDIS_CRED_ENCRYPTION_KEY   — base64 of 32 random bytes (openssl rand -base64 32)
//   INTERNAL_FUNCTION_SECRET    — shared secret for X-Internal-Secret header
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Redis } from "npm:ioredis@5.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIS_ADMIN_URL = Deno.env.get("REDIS_ADMIN_URL")!;
const ENCRYPTION_KEY_B64 = Deno.env.get("REDIS_CRED_ENCRYPTION_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// -----------------------------------------------------------------------------
// AES-256-GCM via Web Crypto (same API in Deno + Node 18+, so the Next.js
// API route can decrypt with the same algorithm).
// -----------------------------------------------------------------------------
async function importKey(): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(ENCRYPTION_KEY_B64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(plaintext: string): Promise<{ cipher: string; iv: string }> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    cipher: btoa(String.fromCharCode(...new Uint8Array(buf))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

// -----------------------------------------------------------------------------
// Password + username generators (URL-safe charset so creds work in rediss://)
// -----------------------------------------------------------------------------
function generatePassword(length = 32): string {
  // URL-safe alphabet (RFC 3986 unreserved) — no +/= so it embeds cleanly in URLs.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let pwd = "";
  for (let i = 0; i < length; i++) pwd += chars[bytes[i] % chars.length];
  return pwd;
}

function generateUsername(): string {
  // sub_<32 hex chars> — 128 bits of entropy, fits Redis ACL username constraints.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sub_${hex}`;
}

function generateApiKey(): string {
  // nta_<43 base62 chars> — ~256 bits of entropy. Shape matches common API key
  // conventions (Stripe sk_, OpenAI sk-, GitHub ghp_). URL-safe.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(43));
  let key = "nta_";
  for (let i = 0; i < 43; i++) key += chars[bytes[i] % chars.length];
  return key;
}

// -----------------------------------------------------------------------------
// Redis ACL operations (via ioredis .call() — ACL is a regular command)
// -----------------------------------------------------------------------------
const ACL_RULES = [
  "on",
  "~signals:*",
  "+ping", "+hello", "+client",
  "+xread", "+xreadgroup", "+xgroup", "+xack", "+xpending", "+xclaim",
  "+xinfo", "+xlen", "+xrange", "+xrevrange",
];

async function aclSetUser(redis: Redis, username: string, password: string): Promise<void> {
  // ACL SETUSER <name> on >password ~signals:* +cmd +cmd ...
  await redis.call("ACL", "SETUSER", username, `>${password}`, ...ACL_RULES);
}

async function aclAddPassword(redis: Redis, username: string, password: string): Promise<void> {
  // Add a new password (user can auth with either old OR new during rotation)
  await redis.call("ACL", "SETUSER", username, `>${password}`);
}

async function aclRemovePassword(redis: Redis, username: string, password: string): Promise<void> {
  // Remove the old password (instant invalidation)
  await redis.call("ACL", "SETUSER", username, `<${password}`);
}

async function aclDelUser(redis: Redis, username: string): Promise<void> {
  await redis.call("ACL", "DELUSER", username);
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------
async function handleProvision(body: {
  subscriptionId: string;
  userId: string;
  planId: string;
}): Promise<Response> {
  // Idempotency: if an active row already exists, no-op.
  const { data: existing } = await supabase
    .from("redis_credentials")
    .select("id, redis_username")
    .eq("subscription_id", body.subscriptionId)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    return Response.json({ ok: true, alreadyProvisioned: true });
  }

  // Fetch plan to derive stream name.
  const { data: plan } = await supabase
    .from("plans")
    .select("id, title, slug")
    .eq("id", body.planId)
    .maybeSingle();

  const username = generateUsername();
  const password = generatePassword(32);
  const apiKey = generateApiKey();
  const streamName = `signals:${plan?.slug ?? body.planId}`;
  const consumerGroup = username;

  // 1. Provision the ACL user in Redis.
  const redis = new Redis(REDIS_ADMIN_URL, { maxRetriesPerRequest: 3 });
  try {
    await aclSetUser(redis, username, password);
  } catch (e: any) {
    redis.quit();
    return Response.json(
      { ok: false, error: `Redis ACL SETUSER failed: ${e.message}` },
      { status: 500 },
    );
  }
  redis.quit();

  // 2. Encrypt the password + API key.
  const pwdEnc = await encrypt(password);
  const apiEnc = await encrypt(apiKey);

  // 3. Store in Supabase.
  const { error } = await supabase.from("redis_credentials").insert({
    subscription_id: body.subscriptionId,
    user_id: body.userId,
    plan_id: body.planId,
    redis_username: username,
    password_cipher: pwdEnc.cipher,
    password_iv: pwdEnc.iv,
    password_version: 1,
    api_key_cipher: apiEnc.cipher,
    api_key_iv: apiEnc.iv,
    api_key_version: 1,
    stream_name: streamName,
    consumer_group: consumerGroup,
  });

  if (error) {
    // Best-effort cleanup: delete the Redis user we just created so we don't
    // leak orphans. The daily sweep cron will catch any that slip through.
    const cleanup = new Redis(REDIS_ADMIN_URL);
    try { await aclDelUser(cleanup, username); } catch { /* ignore */ }
    cleanup.quit();
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, provisioned: true });
}

async function handleRevoke(body: { subscriptionId: string }): Promise<Response> {
  const { data: creds } = await supabase
    .from("redis_credentials")
    .select("id, redis_username")
    .eq("subscription_id", body.subscriptionId)
    .is("revoked_at", null);

  if (!creds || creds.length === 0) {
    return Response.json({ ok: true, revoked: 0 });
  }

  const redis = new Redis(REDIS_ADMIN_URL, { maxRetriesPerRequest: 3 });
  let revoked = 0;
  try {
    for (const c of creds) {
      try {
        await aclDelUser(redis, c.redis_username);
      } catch (e: any) {
        console.error(`ACL DELUSER ${c.redis_username} failed:`, e.message);
        // Continue — mark revoked in DB anyway so the sweep doesn't retry forever.
      }
      await supabase
        .from("redis_credentials")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", c.id);
      revoked++;
    }
  } finally {
    redis.quit();
  }

  return Response.json({ ok: true, revoked });
}

async function handleRotate(body: { subscriptionId: string }): Promise<Response> {
  // Fetch the current active credential row.
  const { data: cred } = await supabase
    .from("redis_credentials")
    .select("id, redis_username, password_cipher, password_iv, password_version")
    .eq("subscription_id", body.subscriptionId)
    .is("revoked_at", null)
    .maybeSingle();

  if (!cred) {
    return Response.json(
      { ok: false, error: "No active credentials to rotate" },
      { status: 404 },
    );
  }

  // Decrypt the old password (we need it to remove from Redis ACL).
  const key = await importKey();
  const oldIv = Uint8Array.from(atob(cred.password_iv), (c) => c.charCodeAt(0));
  const oldCipher = Uint8Array.from(atob(cred.password_cipher), (c) => c.charCodeAt(0));
  const oldPlainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: oldIv },
    key,
    oldCipher,
  );
  const oldPassword = new TextDecoder().decode(oldPlainBuf);

  // Generate new password.
  const newPassword = generatePassword(32);

  // Zero-downtime rotation:
  //   1. ACL SETUSER >newpassword  → both old + new work
  //   2. Update Supabase           → if Redis fails after step 1, DB has the new
  //   3. ACL SETUSER <oldpassword  → old instantly invalid
  const redis = new Redis(REDIS_ADMIN_URL, { maxRetriesPerRequest: 3 });
  try {
    await aclAddPassword(redis, cred.redis_username, newPassword);
  } catch (e: any) {
    redis.quit();
    return Response.json(
      { ok: false, error: `Redis ACL add-password failed: ${e.message}` },
      { status: 500 },
    );
  }

  // Encrypt + store the new password before removing the old (so if step 3
  // fails, the user still has a working password).
  const newEnc = await encrypt(newPassword);
  const newVersion = cred.password_version + 1;

  const { error } = await supabase
    .from("redis_credentials")
    .update({
      password_cipher: newEnc.cipher,
      password_iv: newEnc.iv,
      password_version: newVersion,
      rotated_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  if (error) {
    // DB write failed — the new password is in Redis but we can't recover it.
    // Remove it so the user falls back to the old (still in DB).
    try { await aclRemovePassword(redis, cred.redis_username, newPassword); } catch { /* ignore */ }
    redis.quit();
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Now safe to remove the old password.
  try {
    await aclRemovePassword(redis, cred.redis_username, oldPassword);
  } catch (e: any) {
    // Non-fatal: the old password still works until the next rotation. Log it.
    console.error(`ACL remove-old-password failed: ${e.message}`);
  }
  redis.quit();

  return Response.json({ ok: true, rotated: true, passwordVersion: newVersion });
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Auth check — shared internal secret.
  const secret = req.headers.get("x-internal-secret");
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { action } = body;
  try {
    switch (action) {
      case "provision":
        if (!body.subscriptionId || !body.userId || !body.planId) {
          return Response.json(
            { ok: false, error: "subscriptionId, userId, planId required" },
            { status: 400 },
          );
        }
        return await handleProvision(body);
      case "revoke":
        if (!body.subscriptionId) {
          return Response.json(
            { ok: false, error: "subscriptionId required" },
            { status: 400 },
          );
        }
        return await handleRevoke(body);
      case "rotate":
        if (!body.subscriptionId) {
          return Response.json(
            { ok: false, error: "subscriptionId required" },
            { status: 400 },
          );
        }
        return await handleRotate(body);
      default:
        return Response.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (e: any) {
    console.error("redis-credentials-manager error:", e);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
});
