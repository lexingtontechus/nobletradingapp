// =============================================================================
// Noble Trading App — Redis Credentials Panel
// =============================================================================
// Bash-like text area that displays the subscriber's Redis credentials bundle
// as env vars (REDIS_URL, REDIS_USERNAME, REDIS_PASSWORD, etc.) with copy
// buttons + a "Download .env" button + a "Rotate credentials" button.
//
// SECURITY UX:
//   - Credentials are HIDDEN by default behind a "Reveal credentials" button.
//     This prevents accidental exposure on screen-share / video calls.
//   - The fetch to /api/redis-credentials only happens AFTER the user clicks
//     reveal — no sensitive data is in memory until needed.
//   - Per-line copy buttons + a "Copy all" button.
//   - The "Rotate credentials" action requires a confirm modal because it
//     instantly invalidates the old password (any bot using it disconnects).
//
// SHOWN WHEN:
//   - Subscription status is 'active' or 'grace' (parent decides)
//
// HIDDEN WHEN:
//   - Subscription is 'pending' (no creds yet — show a different message)
//   - Subscription is 'expired' or 'cancelled' (creds revoked)
// =============================================================================

"use client"
import { useState, useCallback } from "react"
import {
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Download,
  AlertTriangle,
  Terminal
} from "lucide-react"

export function RedisCredentialsPanel() {
  const [revealed, setRevealed] = useState(false)
  const [bundle, setBundle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotating, setRotating] = useState(false)

  const fetchCreds = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/redis-credentials", { cache: "no-store" })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(b.error || `Failed (${r.status})`)
      }
      const data = await r.json()
      setBundle(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  function handleReveal() {
    setRevealed(true)
    if (!bundle) fetchCreds()
  }

  function handleHide() {
    setRevealed(false)
    // Don't clear the bundle — user might re-reveal quickly; avoids re-fetch.
  }

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
      // Fallback for older browsers / insecure contexts
      const ta = document.createElement("textarea")
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    }
  }

  function copyAll() {
    if (!bundle) return
    const text = renderEnvFile(bundle)
    copy(text, "__all__")
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  function downloadEnv() {
    if (!bundle) return
    const text = renderEnvFile(bundle)
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `.env.nta.${bundle.planSlug ?? "subscription"}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleRotate() {
    setRotating(true)
    setError(null)
    try {
      const r = await fetch("/api/redis-credentials/rotate", { method: "POST" })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(b.error || `Failed (${r.status})`)
      }
      setRotateOpen(false)
      // Refetch to show the new password
      await fetchCreds()
    } catch (e) {
      setError(e.message)
    } finally {
      setRotating(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Hidden state — show the reveal button
  // ---------------------------------------------------------------------------
  if (!revealed) {
    return (
      <div className="card bg-base-100 shadow border border-base-300">
        <div className="card-body">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Terminal className="w-5 h-5 text-base-content/60" />
              <div>
                <h3 className="font-semibold">Signal stream credentials</h3>
                <p className="text-sm opacity-60">
                  Redis credentials for your trading bot. Hidden by default.
                </p>
              </div>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={handleReveal}
              disabled={loading}
            >
              <Eye className="w-4 h-4" />
              Reveal credentials
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Revealed state — show the bash-like text area
  // ---------------------------------------------------------------------------
  return (
    <div className="card bg-base-100 shadow border border-base-300 overflow-hidden">
      {/* Header bar */}
      <div className="bg-zinc-900 px-4 py-2.5 flex items-center justify-between border-b border-zinc-800">
        <div className="flex items-center gap-2">
          {/* macOS-style traffic lights for the terminal aesthetic */}
          <div className="flex gap-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <span className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-zinc-300 text-xs font-mono">
            noble-trading — credentials.env
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-xs btn-ghost text-zinc-300 hover:text-zinc-100"
            onClick={copyAll}
            disabled={!bundle || loading}
            title="Copy all"
          >
            {copiedAll ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedAll ? "Copied" : "Copy all"}
          </button>
          <button
            className="btn btn-xs btn-ghost text-zinc-300 hover:text-zinc-100"
            onClick={downloadEnv}
            disabled={!bundle || loading}
            title="Download .env"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            className="btn btn-xs btn-ghost text-zinc-300 hover:text-zinc-100"
            onClick={handleHide}
            title="Hide"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body — the bash-like text area */}
      <div className="bg-zinc-950 p-4 font-mono text-sm overflow-x-auto min-h-[280px]">
        {loading && (
          <div className="text-zinc-500 flex items-center gap-2">
            <span className="loading loading-spinner loading-sm" />
            Fetching credentials…
          </div>
        )}
        {error && (
          <div className="text-red-400">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            {error}
            <button
              className="btn btn-xs btn-ghost ml-2 text-zinc-300"
              onClick={fetchCreds}
            >
              Retry
            </button>
          </div>
        )}
        {bundle && !loading && (
          <CredentialsLines
            bundle={bundle}
            copiedKey={copiedKey}
            onCopy={copy}
          />
        )}
      </div>

      {/* Footer — rotation + metadata */}
      <div className="bg-zinc-900/50 px-4 py-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-zinc-500 font-mono">
          {bundle && (
            <>
              password v{bundle.passwordVersion} · rotated{" "}
              {new Date(bundle.rotatedAt).toLocaleString()}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-ghost text-zinc-300"
            onClick={() => setRotateOpen(true)}
            disabled={!bundle || rotating}
          >
            <RefreshCw
              className={`w-4 h-4 ${rotating ? "animate-spin" : ""}`}
            />
            Rotate credentials
          </button>
        </div>
      </div>

      {/* Rotate confirm modal */}
      {rotateOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Rotate credentials?
            </h3>
            <p className="py-4 text-sm opacity-80">
              This generates a new password and{" "}
              <strong>instantly invalidates</strong> the current one. Any bot
              using the old password will disconnect within seconds. Make sure
              you can update your bot's config right away.
            </p>
            <p className="text-sm opacity-70 pb-2">
              The rotation is <strong>zero-downtime on the Redis side</strong> —
              the new password is added before the old one is removed. But your
              bot won't know the new password until you update it.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setRotateOpen(false)}
                disabled={rotating}
              >
                Cancel
              </button>
              <button
                className="btn btn-warning"
                onClick={handleRotate}
                disabled={rotating}
              >
                {rotating ? "Rotating…" : "Rotate now"}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => !rotating && setRotateOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// The actual env-var lines, with per-line copy buttons + syntax highlighting
// -----------------------------------------------------------------------------
function CredentialsLines({ bundle, copiedKey, onCopy }) {
  const lines = [
    { key: "REDIS_URL", value: bundle.redisUrl },
    { key: "REDIS_USERNAME", value: bundle.redisUsername },
    { key: "REDIS_PASSWORD", value: bundle.redisPassword },
    { key: "REDIS_STREAM_SIGNALS", value: bundle.streamName },
    { key: "REDIS_CONSUMER_GROUP", value: bundle.consumerGroup },
    { key: "NTA_PLAN", value: bundle.planSlug ?? bundle.planName },
    { key: "NTA_SUBSCRIPTION_ID", value: bundle.subscriptionId }
  ]
  if (bundle.apiKey) {
    lines.push({ key: "NTA_API_KEY", value: bundle.apiKey })
  }

  return (
    <div className="space-y-0.5">
      {/* Header comment */}
      <CommentLine text={`# Noble Trading App — Signal Stream Credentials`} />
      <CommentLine text={`# Plan: ${bundle.planName}`} />
      <CommentLine
        text={`# Generated: ${new Date(
          bundle.rotatedAt
        ).toISOString()} (password v${bundle.passwordVersion})`}
      />
      <CommentLine
        text={`# WARNING: keep these secret. Rotate immediately if leaked.`}
      />
      <div className="h-2" />

      {/* Env var lines */}
      {lines.map(line => (
        <div
          key={line.key}
          className="group relative flex items-center hover:bg-zinc-900/60 -mx-2 px-2 rounded"
        >
          <span className="text-emerald-400">{line.key}</span>
          <span className="text-zinc-500 mx-1">=</span>
          <span className="text-amber-300 break-all">{line.value}</span>
          <button
            className="absolute right-0 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity btn btn-xs btn-ghost text-zinc-400 hover:text-zinc-100 px-2"
            onClick={() => onCopy(line.value, line.key)}
            title={`Copy ${line.key}`}
          >
            {copiedKey === line.key ? (
              <Check className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      ))}

      <div className="h-3" />

      {/* Usage examples */}
      <CommentLine text={`# Test connection:`} />
      <CommandLine
        text={`redis-cli -u "$REDIS_URL" XINFO STREAM "$REDIS_STREAM_SIGNALS"`}
        onCopy={onCopy}
        copied={copiedKey === "__cmd1__"}
        copyKey="__cmd1__"
      />
      <div className="h-1.5" />
      <CommentLine
        text={`# Read latest 10 signals (new consumer — auto-creates the group):`}
      />
      <CommandLine
        text={`redis-cli -u "$REDIS_URL" XGROUP CREATE "$REDIS_STREAM_SIGNALS" "$REDIS_CONSUMER_GROUP" $ MKSTREAM`}
        onCopy={onCopy}
        copied={copiedKey === "__cmd2__"}
        copyKey="__cmd2__"
      />
      <div className="h-1.5" />
      <CommentLine text={`# Tail new signals as they arrive:`} />
      <CommandLine
        text={`redis-cli -u "$REDIS_URL" XREADGROUP GROUP "$REDIS_CONSUMER_GROUP" worker-1 BLOCK 0 COUNT 10 STREAMS "$REDIS_STREAM_SIGNALS" >`}
        onCopy={onCopy}
        copied={copiedKey === "__cmd3__"}
        copyKey="__cmd3__"
      />
    </div>
  )
}

function CommentLine({ text }) {
  return <div className="text-zinc-500 text-xs leading-relaxed">{text}</div>
}

function CommandLine({ text, onCopy, copied, copyKey }) {
  return (
    <div className="group relative flex items-start hover:bg-zinc-900/60 -mx-2 px-2 rounded">
      <span className="text-sky-300/90 break-all pr-8">$ {text}</span>
      <button
        className="absolute right-0 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity btn btn-xs btn-ghost text-zinc-400 hover:text-zinc-100 px-2"
        onClick={() => onCopy(text, copyKey)}
        title="Copy command"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Render the credentials bundle as a .env file (for copy-all + download)
// -----------------------------------------------------------------------------
function renderEnvFile(b) {
  const lines = [
    `# Noble Trading App — Signal Stream Credentials`,
    `# Plan: ${b.planName}`,
    `# Generated: ${new Date(b.rotatedAt).toISOString()} (password v${
      b.passwordVersion
    })`,
    `# WARNING: keep these secret. Rotate immediately if leaked.`,
    ``,
    `REDIS_URL=${b.redisUrl}`,
    `REDIS_USERNAME=${b.redisUsername}`,
    `REDIS_PASSWORD=${b.redisPassword}`,
    `REDIS_STREAM_SIGNALS=${b.streamName}`,
    `REDIS_CONSUMER_GROUP=${b.consumerGroup}`,
    `NTA_PLAN=${b.planSlug ?? b.planName}`,
    `NTA_SUBSCRIPTION_ID=${b.subscriptionId}`
  ]
  if (b.apiKey) lines.push(`NTA_API_KEY=${b.apiKey}`)
  return lines.join("\n")
}
