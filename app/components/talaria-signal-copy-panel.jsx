// =============================================================================
// Noble Trading App — Talaria Signal Copy Download Panel
// =============================================================================
// Three file downloads + claim-token reveal for Talaria Signal Copy:
//   TalariaCopy.mq5 · TalariaCopy.set · otc_token.txt
// Plus Python bridge install steps (Windows / macOS).
//
// GATED BY: parent only renders for active/grace subscriptions.
// =============================================================================

"use client"
import { useState, useCallback, useEffect } from "react"
import { Download, KeyRound, Eye, AlertTriangle, FileText, Monitor, Laptop } from "lucide-react"

const FILE_MQ5 = process.env.NEXT_PUBLIC_TALARIA_SIGNAL_COPY || "/talaria/TalariaCopy.mq5"
const FILE_SET = process.env.NEXT_PUBLIC_TALARIA_SIGNAL_COPY_SET || "/talaria/TalariaCopy.set"
const FILE_BRIDGE = "/talaria/bridge/talaria_bridge.py"
const FILE_REQS = "/talaria/bridge/requirements.txt"
const FILE_CFG = "/talaria/bridge/config.json"

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function detectOs() {
  if (typeof navigator === "undefined") return "other"
  const ua = navigator.userAgent || ""
  const plat = navigator.platform || ""
  if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(plat)) return "mac"
  if (/Win/i.test(ua) || /Win/i.test(plat)) return "windows"
  return "other"
}

function DownloadRow({ href, filename, title, hint }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-base-300 last:border-0">
      <FileText className="w-4 h-4 opacity-60 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-sm">{filename}</div>
        {hint && <div className="text-xs opacity-50">{hint}</div>}
      </div>
      <a href={href} download={filename} className="btn btn-primary btn-sm shrink-0">
        <Download className="w-4 h-4" />
        {title || "Download"}
      </a>
    </div>
  )
}

export function TalariaSignalCopyPanel() {
  const [bundle, setBundle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [os, setOs] = useState("other")

  useEffect(() => {
    setOs(detectOs())
  }, [])

  const mintToken = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/talaria-claim", { method: "POST", cache: "no-store" })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(b.error || `Failed (${r.status})`)
      }
      setBundle(await r.json())
      setRevealed(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  function downloadTokenFile() {
    if (!bundle?.token) return
    // Same pattern as credentials panel .env download — one file, ready to drop in.
    downloadTextFile("otc_token.txt", `${bundle.token}\n`)
  }

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <div className="flex items-center gap-3">
          <Download className="w-5 h-5 text-primary" />
          <div>
            <h3 className="font-semibold">Talaria Signal Copy</h3>
            <p className="text-sm opacity-60">
              Download the files, install the bridge, and copy signals into MetaTrader&nbsp;5.
            </p>
          </div>
        </div>

        {/* ── 1a. MetaTrader 5 files ──────────────────────────────────── */}
        <div className="mt-4">
          <h4 className="font-semibold text-sm mb-1">1. MetaTrader 5 files</h4>
          <DownloadRow
            href={FILE_MQ5}
            filename="TalariaCopy.mq5"
            title="Download .mq5"
            hint="Expert advisor (chart confirm buttons)"
          />
          <DownloadRow
            href={FILE_SET}
            filename="TalariaCopy.set"
            title="Download .set"
            hint="Default EA settings (optional)"
          />
          {!revealed ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
              <KeyRound className="w-4 h-4 opacity-60 shrink-0" />
              <div className="flex-1">
                <div className="font-mono text-sm">otc_token.txt</div>
                <div className="text-xs opacity-50">
                  Your claim token — the EA reads this to connect
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm shrink-0"
                onClick={mintToken}
                disabled={loading}
              >
                <Eye className="w-4 h-4" />
                {loading ? "Minting…" : "Reveal claim token"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
              <KeyRound className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm">otc_token.txt</div>
                <div className="text-xs opacity-50 break-all font-mono">
                  {bundle?.token ? `${bundle.token.slice(0, 16)}…` : ""}
                </div>
              </div>
              <button className="btn btn-primary btn-sm shrink-0" onClick={downloadTokenFile}>
                <Download className="w-4 h-4" />
                Download .txt
              </button>
            </div>
          )}
          {error && (
            <div className="alert alert-error mt-2 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
          <div className="mt-2 rounded-lg border border-base-300 p-3">
            <div className="text-xs font-semibold mb-1">Where to put these</div>
            <ul className="text-xs opacity-70 space-y-1">
              <li>
                <code className="font-mono">TalariaCopy.mq5</code> →{" "}
                <code className="font-mono">MQL5\Experts\</code> (Windows) or{" "}
                <code className="font-mono">MQL5/Experts/</code> (Mac) — then
                MetaTrader&nbsp;5 → Navigator → refresh → drag onto a chart
              </li>
              <li>
                <code className="font-mono">TalariaCopy.set</code> →{" "}
                <code className="font-mono">MQL5\Presets\</code> (optional)
              </li>
              <li>
                <code className="font-mono">otc_token.txt</code> →{" "}
                <code className="font-mono">MQL5\Files\</code> (Windows) or{" "}
                <code className="font-mono">MQL5/Files/</code> (Mac)
              </li>
            </ul>
          </div>
        </div>

        {/* ── 1b. Python bridge ───────────────────────────────────────── */}
        <div className="mt-4">
          <h4 className="font-semibold text-sm mb-1">2. Python bridge files</h4>
          <DownloadRow
            href={FILE_BRIDGE}
            filename="talaria_bridge.py"
            title="Download .py"
            hint="Main program"
          />
          <DownloadRow
            href={FILE_REQS}
            filename="requirements.txt"
            title="Download"
            hint="Python packages list"
          />
          <DownloadRow
            href={FILE_CFG}
            filename="config.json"
            title="Download"
            hint="Risk &amp; settings"
          />
          <div className="mt-2 rounded-lg border border-base-300 p-3">
            <div className="text-xs font-semibold mb-1">Where to put these</div>
            <ul className="text-xs opacity-70 space-y-1">
              <li>
                Make one folder:{" "}
                <code className="font-mono">C:\Talaria\</code> (Windows) or{" "}
                <code className="font-mono">~/Talaria/</code> (Mac)
              </li>
              <li>
                Put <code className="font-mono">talaria_bridge.py</code>,{" "}
                <code className="font-mono">requirements.txt</code>, and{" "}
                <code className="font-mono">config.json</code> in that folder
              </li>
              <li>
                Also copy <code className="font-mono">otc_token.txt</code> (from
                section 1) into this folder if you use the Python bridge
              </li>
              <li>Do <strong>not</strong> put these inside the MetaTrader 5 folder</li>
            </ul>
          </div>
        </div>

        {/* ── 3. Run the bridge (OS-aware) ────────────────────────────── */}
        <div className="mt-4">
          <h4 className="font-semibold text-sm mb-1">3. Run the bridge</h4>
          {os === "windows" && (
            <div className="mt-3 rounded-lg border border-base-300 p-3">
              <div className="flex items-center gap-2 font-semibold text-xs mb-2">
                <Monitor className="w-4 h-4 text-primary" />
                Windows steps
              </div>
              <ol className="list-decimal list-inside space-y-1 text-xs opacity-70">
                <li>Install <strong>Python 3.10+</strong> and open <strong>MetaTrader 5</strong> (log in).</li>
                <li>
                  Put the three download files in one folder (e.g.{" "}
                  <code className="font-mono">Talaria</code>), open a terminal there.
                </li>
                <li>
                  <code className="font-mono">pip install -r requirements.txt</code>
                </li>
                <li>
                  <code className="font-mono">python talaria_bridge.py</code>
                </li>
                <li>
                  Keep MetaTrader 5 running. For chart buttons, copy{" "}
                  <code className="font-mono">TalariaCopy.mq5</code> +{" "}
                  <code className="font-mono">TalariaRealtime.mqh</code> into{" "}
                  <code className="font-mono">MQL5\Experts\</code> and attach the EA.
                </li>
              </ol>
            </div>
          )}

          {os === "mac" && (
            <div className="mt-3 rounded-lg border border-base-300 p-3">
              <div className="flex items-center gap-2 font-semibold text-xs mb-2">
                <Laptop className="w-4 h-4 text-primary" />
                macOS steps
              </div>
              <ol className="list-decimal list-inside space-y-1 text-xs opacity-70">
                <li>
                  Install{" "}
                  <strong>MetaTrader 5</strong> from the{" "}
                  <a
                    className="link"
                    href="https://apps.apple.com/us/app/metatrader-5/id413251709"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Mac App Store
                  </a>{" "}
                  (Plexytrade works too) and log in.
                </li>
                <li>
                  Install <strong>Python 3.10+</strong> (python.org or Homebrew).
                </li>
                <li>
                  Put the download files in one folder, open Terminal there.
                </li>
                <li>
                  <code className="font-mono">pip3 install -r requirements.txt</code>
                </li>
                <li>
                  <code className="font-mono">python3 talaria_bridge.py</code>
                </li>
                <li>
                  Keep MetaTrader 5 running. Copy{" "}
                  <code className="font-mono">TalariaCopy.mq5</code> into{" "}
                  <code className="font-mono">MQL5/Experts/</code> and attach the EA
                  if you want on-chart confirm buttons.
                </li>
              </ol>
            </div>
          )}

          {os === "other" && (
            <div className="mt-3 rounded-lg border border-base-300 p-3">
              <div className="text-xs opacity-70">
                Use the <strong>Windows</strong> steps if you are on a PC, or{" "}
                <strong>macOS</strong> steps on a Mac (MetaTrader 5 App Store /
                Plexytrade).
              </div>
            </div>
          )}
        </div>

        <p className="text-xs opacity-50 mt-4">
          Keep <code className="font-mono">otc_token.txt</code> private — it is your
          subscription key. Minting a new token revokes the old one. Need help?
          Join Discord from the portal.
        </p>
      </div>
    </div>
  )
}
