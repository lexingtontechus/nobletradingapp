// =============================================================================
// Noble Trading App — Talaria Credentials Panel
// =============================================================================
// Bash-like text area that displays the subscriber's Talaria client bundle:
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TALARIA_CLAIM_TOKEN, plan, expiry
// with per-line copy buttons + a "Download .env" button + a "Mint new token"
// button.
//
// The claim token is minted by POST /api/talaria-claim (server-side; requires
// an active/grace subscription). The token is stored only as a SHA-256 hash in
// talaria_claims — the raw token is returned exactly once and shown here for
// the user to paste into the Hermes agent Talaria plugin.
//
// SECURITY UX (mirrors the retired Redis credentials panel):
//   - Values are HIDDEN by default behind a "Reveal credentials" button.
//   - The fetch to /api/talaria-claim only happens AFTER the user clicks
//     reveal — no sensitive data is in memory until needed.
//   - "Mint new token" revokes the previous token (single-active-token policy
//     in migration 0006) — requires a confirm modal.
//
// SHOWN WHEN: subscription status is 'active' or 'grace' (parent decides).
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
  Terminal,
  KeyRound
} from "lucide-react"

// -----------------------------------------------------------------------------
// Fixed vars for the Hermes agent Talaria plugin. The publishable (anon) key
// is safe to expose client-side — it is NOT a service-role secret.
// -----------------------------------------------------------------------------
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pcvscowltlrxzgxjurcr.supabase.co"
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY ||
  "sb_publishable_cYfseJa9z0qss0g_Y594wA_lXrWVBsa"

export function TalariaCredentialsPanel() {
  const [revealed, setRevealed] = useState(false)
  const [bundle, setBundle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [mintOpen, setMintOpen] = useState(false)
  const [minting, setMinting] = useState(false)

  const mintToken = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/talaria-claim", {
        method: "POST",
        cache: "no-store"
      })
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
    if (!bundle) mintToken()
  }

  function handleHide() {
    setRevealed(false)
  }

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    } catch {
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
    a.download = `.env.talaria.${bundle.plan_slug ?? "subscription"}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleMint() {
    setMinting(true)
    setError(null)
    try {
      await mintToken()
      setMintOpen(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setMinting(false)
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
              <KeyRound className="w-5 h-5 text-base-content/60" />
              <div>
                <h3 className="font-semibold">Talaria client credentials</h3>
                <p className="text-sm opacity-60">
                  Claim token + Supabase connection for the Hermes agent
                  Talaria plugin. Hidden by default.
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
          <div className="flex gap-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <span className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-zinc-300 text-xs font-mono">
            talaria — hermes-plugin.env
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
            Minting claim token…
          </div>
        )}
        {error && (
          <div className="text-red-400">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            {error}
            <button
              className="btn btn-xs btn-ghost ml-2 text-zinc-300"
              onClick={mintToken}
            >
              Retry
            </button>
          </div>
        )}
        {bundle && !loading && (
          <TalariaLines
            bundle={bundle}
            copiedKey={copiedKey}
            onCopy={copy}
          />
        )}
      </div>

      {/* Footer — mint + metadata */}
      <div className="bg-zinc-900/50 px-4 py-3 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-zinc-500 font-mono">
          {bundle && (
            <>
              {bundle.plan_title} · expires{" "}
              {new Date(bundle.expires_at).toLocaleString()}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-ghost text-zinc-300"
            onClick={() => setMintOpen(true)}
            disabled={!bundle || minting}
          >
            <RefreshCw
              className={`w-4 h-4 ${minting ? "animate-spin" : ""}`}
            />
            Mint new token
          </button>
        </div>
      </div>

      {/* Mint confirm modal */}
      {mintOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              Mint a new token?
            </h3>
            <p className="py-4 text-sm opacity-80">
              This revokes your current Talaria token and issues a new one.
              Any client already connected with the old token will need to be
              updated with the new value.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setMintOpen(false)}
                disabled={minting}
              >
                Cancel
              </button>
              <button
                className="btn btn-warning"
                onClick={handleMint}
                disabled={minting}
              >
                {minting ? "Minting…" : "Mint new token"}
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop"
            onClick={() => !minting && setMintOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// The env-var lines, with per-line copy buttons
// -----------------------------------------------------------------------------
function TalariaLines({ bundle, copiedKey, onCopy }) {
  const lines = [
    { key: "SUPABASE_URL", value: SUPABASE_URL },
    { key: "SUPABASE_PUBLISHABLE_KEY", value: SUPABASE_PUBLISHABLE_KEY },
    { key: "TALARIA_CLAIM_TOKEN", value: bundle.token },
    { key: "TALARIA_PLAN", value: bundle.plan_slug ?? bundle.plan_title },
    { key: "TALARIA_EXPIRES_AT", value: bundle.expires_at }
  ]

  return (
    <div className="space-y-0.5">
      <CommentLine text={`# Noble Trading App — Talaria Client Credentials`} />
      <CommentLine text={`# Plan: ${bundle.plan_title}`} />
      <CommentLine
        text={`# Token expires: ${new Date(bundle.expires_at).toISOString()}`}
      />
      <CommentLine
        text={`# WARNING: keep these secret. Mint a new token if leaked.`}
      />
      <div className="h-2" />

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

      <CommentLine
        text={`# Paste these into the Hermes agent Talaria plugin Connect tab.`}
      />
      <CommentLine
        text={`# The claim token proves identity; the live subscription decides access.`}
      />
    </div>
  )
}

function CommentLine({ text }) {
  return <div className="text-zinc-500 text-xs leading-relaxed">{text}</div>
}

// -----------------------------------------------------------------------------
// Render the credentials bundle as a .env file (for copy-all + download)
// -----------------------------------------------------------------------------
function renderEnvFile(b) {
  const lines = [
    `# Noble Trading App — Talaria Client Credentials`,
    `# Plan: ${b.plan_title}`,
    `# Token expires: ${new Date(b.expires_at).toISOString()}`,
    `# WARNING: keep these secret. Mint a new token if leaked.`,
    ``,
    `SUPABASE_URL=${SUPABASE_URL}`,
    `SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY}`,
    `TALARIA_CLAIM_TOKEN=${b.token}`,
    `TALARIA_PLAN=${b.plan_slug ?? b.plan_title}`,
    `TALARIA_EXPIRES_AT=${b.expires_at}`
  ]
  return lines.join("\n")
}
