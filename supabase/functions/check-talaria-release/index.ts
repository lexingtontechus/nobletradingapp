// =============================================================================
// Noble Trading App — Supabase Edge Function: check-talaria-release
// =============================================================================
// Triggered daily by pg_cron (see migration 0008 for the schedule recipe).
// Polls the GitHub Releases API for the latest Talaria plugin release and emails
// all active/grace subscribers who haven't been notified of that version yet.
//
// Flow:
//   1. GET https://api.github.com/repos/lexingtontechus/noble-trader-talaria/releases/latest
//   2. Parse tag_name (e.g. "v0.2.14") → version "0.2.14"
//   3. Query v_talaria_release_eligible for active/grace subscribers
//      (the view already joins users → subscriptions → plans)
//   4. For each eligible user where NOT EXISTS a notification row for this version:
//      - Build release notes (user-friendly, from the GitHub release body)
//      - Build install instructions + download link (plan-aware: Precision Pro
//        gets the in-app badge note; Signal Scout gets the portal link)
//      - Send via AgentMail with Idempotency-Key (idempotent retry-safe)
//      - INSERT into plugin_release_notifications (audit + dedupe)
//
// Env vars (auto-injected by Supabase):
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected (bypasses RLS)
//   AGENTMAIL_API_KEY           — set via: supabase secrets set AGENTMAIL_API_KEY=am_...
//   AGENTMAIL_INBOX_ID          — set via: supabase secrets set AGENTMAIL_INBOX_ID=...
//
// Idempotency: AgentMail Idempotency-Key = `release-<version>-<userId>-<digest>`
// The plugin_release_notifications table also dedupes at the DB level (unique
// on (user_id, version)) so a re-run is a complete no-op per user.
//
// GitHub API: anonymous (public repo), 60 req/hr rate limit. We make ONE call
// per daily cron run — well within budget.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENTMAIL_API_KEY = Deno.env.get("AGENTMAIL_API_KEY")!;
const AGENTMAIL_INBOX_ID = Deno.env.get("AGENTMAIL_INBOX_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/lexingtontechus/noble-trader-talaria/releases/latest";

const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";

// ----------------------------------------------------------------------------
// Simple hash of the release body for Idempotency-Key uniqueness.
// Ensures that if the body changes between runs of the SAME tag, the
// Idempotency-Key differs and a re-send happens. In practice the body is
// immutable per release tag, so this is belt-and-suspenders.
// ----------------------------------------------------------------------------
function bodyDigest(body: string): string {
  let h = 0;
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) - h + body.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

// ----------------------------------------------------------------------------
// Strip markdown → plain text for the email body
// ----------------------------------------------------------------------------
function stripMarkdown(md: string): string {
  if (!md) return "";
  return md
    .replace(/^---\s*$/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/-\s*$/gm, "")
    .replace(/^\s*- (.*$)/gm, "• $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ----------------------------------------------------------------------------
// Build user-friendly release notes from the GitHub release body
// ----------------------------------------------------------------------------
function formatReleaseNotes(body: string): string {
  const stripped = stripMarkdown(body);
  if (!stripped) return "No release notes were provided for this version.";
  const sections = stripped.split("\n\n---\n\n");
  return sections[0];
}

// ----------------------------------------------------------------------------
// Build the email HTML for a given user + plan + release
// ----------------------------------------------------------------------------
function buildEmailHtml(
  firstName: string | null,
  planTitle: string,
  planSlug: string,
  versionTag: string,
  versionName: string,
  releaseNotes: string,
  downloadUrl: string,
  htmlUrl: string,
): string {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const isPro =
    planSlug === "precision_pro" || planTitle === "Precision Pro";

  // Plan-specific install note
  const installNote = isPro
    ? "<p style=\"color: var(--muted, #6b7280); font-size: 0.875rem;\">\n       You're on the <strong>Precision Pro</strong> plan — the same plugin\n       gives you paper portfolio analytics alongside live signals.\n     </p>"
    : "<p style=\"color: var(--muted, #6b7280); font-size: 0.875rem;\">\n       You're on the <strong>Signal Scout</strong> plan — this update improves\n       signal delivery and chart accuracy for your 10-symbol universe.\n     </p>";

  const releaseUrl = htmlUrl || GITHUB_RELEASES_URL;
  const escapedNotes = releaseNotes
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 600; color: #111827; margin: 0; }
    .subtitle { font-size: 14px; color: #6b7280; margin: 4px 0 0; }
    .content { line-height: 1.6; color: #374151; font-size: 15px; }
    .notes { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; line-height: 1.5; }
    .cta { margin: 24px 0; }
    .btn { display: inline-block; background: #4c9aff; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; font-size: 14px; }
    .install-note { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">Talaria ${versionTag} is available</h1>
      <p class="subtitle">A new version of your Talaria plugin is ready to install.</p>
    </div>

    <div class="content">
      ${greeting}

      <p>A new version of the Talaria plugin — ${versionTag} — is now available
      for your ${planTitle} subscription.</p>

      <div class="install-note">
        ${installNote}
      </div>

      <div class="notes">${escapedNotes}</div>

      <div class="cta">
        <a href="${downloadUrl}" class="btn">Download ${versionTag}</a>
      </div>

      <p style="font-size: 14px; color: #6b7280;">
        After downloading, extract the zip and replace your current plugin file,
        then restart the Hermes desktop app (or run cmd-K → Reload desktop plugins).
      </p>
    </div>

    <div class="footer">
      <p>Release notes: <a href="${releaseUrl}">${versionTag} on GitHub</a></p>
      <p>Sent to ${planTitle} subscribers · <a href="https://nobletrading.app/portal">Open your portal</a></p>
      <p>No longer subscribed? You can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>`;
}

// ----------------------------------------------------------------------------
// Send an email via AgentMail (verified pattern from send-renewal-reminders)
//
//   POST https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/send
//   Headers:
//     Authorization: Bearer <AGENTMAIL_API_KEY>
//     Content-Type: application/json
//     Idempotency-Key: <1-256 chars>  (org-scoped, 24h TTL)
//   Body: { to, subject, text, html }
//   Success: HTTP 200 → { message_id, thread_id }
//   Rate-limited: HTTP 429 + Retry-After
// ----------------------------------------------------------------------------
async function sendReleaseEmail(
  toEmail: string,
  subject: string,
  textBody: string,
  htmlBody: string,
  idempotencyKey: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const resp = await fetch(
      `${AGENTMAIL_BASE_URL}/inboxes/${AGENTMAIL_INBOX_ID}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AGENTMAIL_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          to: toEmail,
          subject,
          text: textBody,
          html: htmlBody,
        }),
      },
    );

    if (resp.ok) {
      const data = await resp.json();
      return { ok: true, messageId: data.message_id };
    } else if (resp.status === 429) {
      // Rate limited — retry-after header
      const retryAfter = resp.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 10000;
      await new Promise((r) => setTimeout(r, waitMs));
      return sendReleaseEmail(toEmail, subject, textBody, htmlBody, idempotencyKey);
    } else {
      const errText = await resp.text();
      return { ok: false, error: `HTTP ${resp.status}: ${errText}` };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------
Deno.serve(async () => {
  if (!AGENTMAIL_API_KEY || !AGENTMAIL_INBOX_ID) {
    const msg =
      "AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID must be set via supabase secrets";
    console.error(msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }

  // 1. Fetch latest GitHub release (anonymous, public repo)
  let release;
  try {
    const ghResp = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nobletradingapp-check-talaria-release",
      },
    });
    if (!ghResp.ok) {
      throw new Error(
        `GitHub API ${ghResp.status}: ${await ghResp.text()}`,
      );
    }
    release = await ghResp.json();
  } catch (e) {
    console.error("Failed to fetch GitHub release:", e);
    return new Response(
      JSON.stringify({ error: "GitHub API fetch failed", detail: String(e) }),
      { status: 502 },
    );
  }

  const versionTag = release.tag_name; // e.g. "v0.2.14"
  const versionNum = versionTag.replace(/^v/, ""); // e.g. "0.2.14"
  const releaseName = release.name || versionTag;
  const releaseBody = release.body || "";
  const releaseHtmlUrl = release.html_url || "";

  // Find the zip asset (if any)
  const zipAsset = release.assets?.find(
    (a: { name: string; browser_download_url: string }) =>
      a.name.endsWith(".zip") && a.name.includes("talaria-plugin"),
  );
  const downloadUrl = zipAsset?.browser_download_url || releaseHtmlUrl;

  // 2. Fetch eligible subscribers (active/grace, with email)
  const { data: users, error: userErr } = await supabase
    .from("v_talaria_release_eligible")
    .select("*");

  if (userErr) {
    console.error("Failed to query v_talaria_release_eligible:", userErr);
    return new Response(
      JSON.stringify({ error: "DB query failed", detail: String(userErr) }),
      { status: 500 },
    );
  }

  // 3. Check which users still need notification for this version
  const notifiedUserIds = new Set<string>();
  for (const u of users) {
    const { data: existing } = await supabase
      .from("plugin_release_notifications")
      .select("user_id")
      .eq("user_id", u.user_id)
      .eq("version", versionNum)
      .maybeSingle();
    if (existing) notifiedUserIds.add(u.user_id);
  }

  const toNotify = users.filter(
    (u: { user_id: string }) => !notifiedUserIds.has(u.user_id),
  );

  if (toNotify.length === 0) {
    console.log(
      `All eligible subscribers already notified of ${versionTag}. No emails sent.`,
    );
    return new Response(
      JSON.stringify({
        version: versionTag,
        notified: 0,
        skipped: users.length,
        message: "Already notified all eligible subscribers",
      }),
    );
  }

  // 4. Send emails
  const releaseNotes = formatReleaseNotes(releaseBody);
  const digest = bodyDigest(releaseBody);
  const subject = `Talaria ${versionTag} is available — plugin update ready`;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const user of toNotify) {
    const idempotencyKey = `release-${versionNum}-${user.user_id}-${digest}`;
    const htmlBody = buildEmailHtml(
      null, // no first name in the v_talaria_release_eligible view
      user.plan_title,
      user.plan_slug,
      versionTag,
      releaseName,
      releaseNotes,
      downloadUrl,
      releaseHtmlUrl,
    );
    const textBody = stripMarkdown(releaseNotes) + `\n\nDownload: ${downloadUrl}`;

    const result = await sendReleaseEmail(
      user.email,
      subject,
      textBody,
      htmlBody,
      idempotencyKey,
    );

    // Record in audit table regardless of success/failure
    await supabase.from("plugin_release_notifications").insert({
      user_id: user.user_id,
      version: versionNum,
      version_tag: versionTag,
      agentmail_message_id: result.messageId || null,
      status: result.ok ? "sent" : "failed",
      error: result.error || null,
    });

    if (result.ok) {
      sent++;
    } else {
      failed++;
      errors.push(`${user.email}: ${result.error}`);
      console.error(`Failed to send to ${user.email}:`, result.error);
    }
  }

  console.log(
    `Talaria ${versionTag} notifications: ${sent} sent, ${failed} failed, ${users.length - toNotify.length} already notified.`,
  );

  return new Response(
    JSON.stringify({
      version: versionTag,
      notified: sent,
      failed,
      skipped: users.length - toNotify.length,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { status: 200 },
  );
});
