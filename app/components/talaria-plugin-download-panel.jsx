// =============================================================================
// Noble Trading App — Talaria Plugin Download Panel
// =============================================================================
// Shown below the Talaria client credentials panel for **Precision Pro**
// subscribers. Displays the Talaria desktop plugin download URL from
// NEXT_PUBLIC_TALARIA_PLUGIN with a copy button + an "Open" link.
//
// GATED BY: the parent only renders this when the subscription's plan is
// Precision Pro (slug 'precision_pro' or title containing 'precision').
// =============================================================================

"use client"
import { useState } from "react"
import { Copy, Check, Download, ExternalLink } from "lucide-react"

const PLUGIN_URL = process.env.NEXT_PUBLIC_TALARIA_PLUGIN

export function TalariaPluginDownloadPanel() {
  const [copied, setCopied] = useState(false)

  if (!PLUGIN_URL) {
    return null
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(PLUGIN_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = PLUGIN_URL
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-semibold">Talaria plugin — Precision Pro</h3>
              <p className="text-sm opacity-60">
                Download the Talaria desktop plugin for the Hermes agent.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <code className="flex-1 break-all bg-base-200 rounded-lg px-3 py-2 text-sm font-mono">
            {PLUGIN_URL}
          </code>
          <div className="flex gap-2">
            <a
              href={PLUGIN_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
            <button
              className="btn btn-sm btn-outline"
              onClick={copyUrl}
              title="Copy download URL"
            >
              {copied ? (
                <Check className="w-4 h-4 text-success" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <p className="text-xs opacity-50 mt-2 flex items-center gap-1">
          <ExternalLink className="w-3 h-3" />
          Requires an active Precision Pro subscription. Install the plugin in
          Hermes, then paste the credentials from the panel above into its
          Connect tab.
        </p>
      </div>
    </div>
  )
}
