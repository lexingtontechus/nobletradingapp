// =============================================================================
// Noble Trading App — Edge Lab Dashboard Page
// =============================================================================
// Port of the kairos-pbm-build edge-lab dashboard to nobletradingapp's
// Tailwind + daisyUI conventions. Every section reads the payload spread by
// /api/edge-lab — no shadcn primitives, no next-themes (the app is dark-only).
//
// Route:   /dashboard/edge-lab
// Source:  /api/edge-lab -> nt_edge_lab_run (latest payload, service role)
// =============================================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  RefreshCw,
  LayoutGrid,
  Waves,
  Mountain,
  Scale,
  Atom,
  BrainCircuit,
  ListChecks,
  ShieldCheck,
  Target,
} from "lucide-react";

import { CalibrationSection } from "@/components/edge-lab/calibration-section";
import { BarrierPhysics } from "@/components/edge-lab/barrier-physics";
import { EdgeSurface } from "@/components/edge-lab/edge-surface";
import { GateBacktest } from "@/components/edge-lab/gate-backtest";
import { HeroStrip } from "@/components/edge-lab/hero-strip";
import { RegimeValues } from "@/components/edge-lab/regime-values";
import { SectionShell } from "@/components/edge-lab/section-shell";
import { TsfmReframe } from "@/components/edge-lab/tsfm-reframe";
import { VerdictMatrix } from "@/components/edge-lab/verdict-matrix";

import { fmtDateLabel } from "@/lib/edge-lab-format";

function LoadingState() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-xl" />
        ))}
      </div>
      <div className="skeleton mb-4 h-8 w-72" />
      <div className="skeleton mb-4 h-72 rounded-xl" />
    </div>
  );
}

export default function EdgeLabPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/edge-lab", { cache: "no-store" });
        // Subscriber-only route: not signed in, or no active subscription →
        // /portal (the plan picker / re-subscribe surface).
        //
        // NOT /welcome: that page is a post-payment onboarding view whose own
        // server gate requires an active/grace subscription, so it can never be
        // a valid access-denied landing — it always bounces straight back to
        // /portal (and, before the route's admin bypass, bounced admins too).
        if (res.status === 401 || res.status === 403) {
          // Keep the data-dependent UI unmounted while the router bounces this
          // page. The `finally` below still clears isLoading, so without this
          // flag the render falls through with data === null and HeroStrip
          // dereferences it ("Cannot read properties of null").
          setIsRedirecting(true);
          router.replace("/portal");
          return;
        }
        const body = await res.json();
        if (!res.ok) {
          throw new Error(typeof body.error === "string" ? body.error : "HTTP " + res.status);
        }
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, router]);

  const handleRefresh = () => setReloadKey((k) => k + 1);

  const meta = data?.meta ?? {};
  const symbols = meta.symbols ?? [];
  const verdicts = data?.verdicts ?? [];
  const fixes = data?.fixes ?? [];
  const fixesLive = fixes.filter((f) => f.mode === "live").length;

  const totalBars = useMemo(() => {
    const perSymbol = meta.bars_per_symbol;
    if (!perSymbol) return 0;
    return Object.values(perSymbol).reduce((a, b) => a + b, 0);
  }, [meta.bars_per_symbol]);

  const runId = meta.run_id ?? "—";
  const engine = meta.engine ?? "regime_edge v1";

  return (
    <div className="min-h-screen bg-base-300">
            <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      {/* Menu bar */}
      {/* Quick nav — link to the Edge-Lab and Portal for subscription management */}
      <div className="flex justify-end-safe m-2">
        <div className="mr-2"><Link href="/dashboard" className="btn btn-sm btn-outline btn-secondary">
         Dashboard
        </Link></div>
        <Link href="/portal" className="btn btn-sm btn-outline btn-secondary">
         Portal
        </Link>
      </div>

    {/* Header */ }
      <header className="sticky top-0 z-40 border-b border-base-300 bg-base-200/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 md:px-8">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
            <Activity className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight md:text-lg">Edge Lab</h1>
              <span className="badge badge-sm badge-outline font-mono">
                Audit
              </span>
            </div>
            <p className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">
              Regime values assigned across the time series → measured conditional edge →
              physics-constrained geometry. Every fix ships live with a test.
            </p>
          </div>
          <span className="hidden shrink-0 font-mono text-xs text-muted-foreground md:block">
            run {runId}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-14 px-4 py-8 md:gap-20 md:px-8 md:py-12">
        {error ? (
          <div className="alert alert-warning">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">Could not load the audit data.</p>
              <p className="font-mono text-xs break-all text-muted-foreground">{error}</p>
            </div>
            <button className="btn btn-sm btn-ghost ml-auto" onClick={handleRefresh}>
              <RefreshCw className="size-4" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : isLoading || isRedirecting ? (
          <LoadingState />
        ) : (
          <>
            {/* 01 — hero verdict strip */}
            <section aria-label="Headline verdicts">
              <div className="mb-5 flex items-start gap-3 md:mb-7 md:gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-base-300 bg-base-100 text-muted-foreground md:size-11">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
                    01
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
                    Verdicts at a glance
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    Every claim below carries a number, a CI, a p-value, or a test count —
                    measured on {symbols.length} symbols × {totalBars.toLocaleString("en-US")}{" "}
                    bars, {fmtDateLabel(meta.period_start)} → {fmtDateLabel(meta.period_end)}.
                  </p>
                </div>
              </div>
              <HeroStrip data={data} />

              {(meta.approximation_notes ?? []).length > 0 ? (
                <div className="collapse collapse-arrow mt-4 border border-base-300 bg-base-200/60">
                  <input type="checkbox" />
                  <div className="collapse-title flex min-h-0 items-center gap-1.5 pr-8 text-xs text-muted-foreground">
                    <ChevronDown className="size-4" aria-hidden="true" />
                    Repro approximations ({meta.approximation_notes.length}) · bands:{" "}
                    {meta.band_source?.file}: {meta.band_source?.lines}
                  </div>
                  <div className="collapse-content">
                    <ul className="grid gap-2 p-3 text-[11px] leading-relaxed text-muted-foreground">
                      {meta.approximation_notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </section>

            {/* 02 — verdict matrix */}
            <SectionShell
              id="verdicts"
              index="02"
              title="Verdict Matrix — the audit"
              description={`${verdicts.length} weaknesses from the evaluation, each judged PROVEN-FAIL, MEASURED, or PROVEN-OK with evidence and fix status.`}
              icon={LayoutGrid}
            >
              <VerdictMatrix data={data} />
            </SectionShell>

            {/* 03 — regime values across time */}
            <SectionShell
              id="regime-values"
              index="03"
              title="Regime Values Across Time"
              description="Every bar gets a deterministic regime value — trend, chop, vol — and a tri-state label, point-in-time with no lookahead."
              icon={Waves}
            >
              <RegimeValues data={data} />
            </SectionShell>

            {/* 04 — conditional edge surface */}
            <SectionShell
              id="edge-surface"
              index="04"
              title="Conditional Edge Surface"
              description="Does the regime value predict the edge? Mean R per feature decile with 95% CIs, and Spearman rho per feature."
              icon={Mountain}
            >
              <EdgeSurface data={data} />
            </SectionShell>

            {/* 05 — gate backtest */}
            <SectionShell
              id="gate-backtest"
              index="05"
              title="Gate Backtest — the three books"
              description="kairos as-is vs the corrected regime-gated book vs the driftless null, pooled and per symbol, with Diebold–Mariano tests."
              icon={Scale}
            >
              <GateBacktest data={data} />
            </SectionShell>

            {/* 06 — calibration */}
            <SectionShell
              id="calibration"
              index="06"
              title="Calibration — flat base rate vs regime-conditional"
              description="Reliability of p(TP) predictions: the level-only live table vs regime-conditional cells."
              icon={Target}
            >
              <CalibrationSection data={data} />
            </SectionShell>

            {/* 07 — barrier physics */}
            <SectionShell
              id="barrier"
              index="07"
              title="Barrier Physics — current vs corrected geometry"
              description="First-passage probabilities for every published bracket, with the driftless-null expectancy as the SL-farm proof."
              icon={Atom}
            >
              <BarrierPhysics data={data} />
            </SectionShell>

            {/* 08 — tsfm reframe */}
            <SectionShell
              id="tsfm"
              index="08"
              title="TSFM Reframe"
              description="What the earlier tsfm+sweep experiments actually proved — and the honest role for zero-shot time-series models."
              icon={BrainCircuit}
            >
              <TsfmReframe data={data} />
            </SectionShell>
          </>
        )}
      </main>

      <footer className="mt-auto border-t border-base-300">
        <div className="mx-auto grid w-full max-w-7xl gap-1 px-4 py-4 text-center text-xs leading-relaxed text-muted-foreground md:px-8">
          <span>
            Edge Lab · run {runId} · engine {engine} · data: {symbols.length} symbols · fixes:{" "}
            {fixesLive} LIVE
          </span>
          {fixes.length === 0 ? (
            <span className="text-warning">
              No fixes recorded in this run — the fixes array is empty pending the coordinator.
            </span>
          ) : null}
        </div>
      </footer>
      </div>
      </div>
  );
}
