"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Info, X } from "lucide-react";

import { FixStatusChip, IdChip, VerdictChip } from "./chips";
import { fmtNum } from "@/lib/edge-lab-format";

const FILTERS = [
  { key: "all", label: "All", prefix: "" },
  { key: "W-C", label: "Coherence (W-C)", prefix: "W-C" },
  { key: "W-X", label: "Chop (W-X)", prefix: "W-X" },
  { key: "W-G", label: "Geometry (W-G)", prefix: "W-G" },
];

/** Render one heterogeneous `numbers` entry defensively. */
function NumberValue({ value }) {
  if (typeof value === "number") return <span>{fmtNum(value, 4)}</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if (Array.isArray(value)) {
    return <span>{value.map((v) => fmtNum(v, 2)).join(" / ")}</span>;
  }
  return (
    <span className="grid gap-0.5">
      {Object.entries(value).map(([k, v]) => (
        <span key={k} className="text-muted-foreground">
          {k}:{" "}
          <span className="text-base-content">
            {typeof v === "number" ? fmtNum(v, 4) : v}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Evidence dialog — a controlled overlay rather than a shadcn Dialog, so the
 * port carries no dependency. Escape and the backdrop both dismiss.
 */
function EvidenceDialog({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Evidence for ${item.id}`}
    >
      <button
        type="button"
        aria-label="Close evidence"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-black/70"
        onClick={onClose}
      />
      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-base-300 bg-base-100 p-5 shadow-2xl">
        <div className="mb-4 grid gap-1.5 border-b border-base-300 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <IdChip id={item.id} />
            <span className="text-base font-semibold">{item.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <VerdictChip kind={item.verdict} />
            <FixStatusChip status={item.fix_status} />
            <span className="badge badge-sm badge-outline font-mono">
              source: {item.source}
            </span>
          </div>
        </div>

        <div className="grid gap-4 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Evidence
            </h3>
            <p className="leading-relaxed">{item.evidence}</p>
          </div>
          {Object.keys(item.numbers).length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Numbers
              </h3>
              <div className="grid gap-1 rounded-lg border border-base-300 bg-base-200/60 p-3 font-mono text-xs">
                {Object.entries(item.numbers).map(([k, v]) => (
                  <div
                    key={k}
                    className="grid gap-0.5 sm:grid-cols-[minmax(140px,auto)_1fr] sm:gap-2"
                  >
                    <span className="text-muted-foreground">{k}:</span>
                    <NumberValue value={v} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {item.fix_summary ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Fix
              </h3>
              <p className="leading-relaxed">{item.fix_summary}</p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="btn btn-sm btn-ghost btn-circle absolute top-4 right-4"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** daisyUI tooltip on the fix-status cell. */
function FixCell({ item }) {
  const chip = <FixStatusChip status={item.fix_status} />;
  if (!item.fix_summary) {
    return <span className="inline-flex items-center gap-1.5">{chip}</span>;
  }
  return (
    <span
      className="tooltip tooltip-top inline-flex items-center gap-1.5"
      data-tip={item.fix_summary}
    >
      {chip}
      <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

export function VerdictMatrix({ data }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  const activePrefix = FILTERS.find((f) => f.key === filter)?.prefix ?? "";

  const rows = useMemo(() => {
    return [...data.verdicts]
      .filter((v) => activePrefix === "" || v.id.startsWith(activePrefix))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [data.verdicts, activePrefix]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs tabs-border" role="tablist" aria-label="Weakness filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`tab ${filter === f.key ? "tab-active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {rows.length} / {data.verdicts.length} weaknesses · sorted by ID
        </p>
      </div>

      {/* Desktop / tablet: table */}
      <div className="hidden overflow-x-auto rounded-xl border border-base-300 md:block">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>ID</th>
              <th>Weakness</th>
              <th>Verdict</th>
              <th>Evidence</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <IdChip id={item.id} />
                </td>
                <td className="font-medium">{item.title}</td>
                <td>
                  <VerdictChip kind={item.verdict} />
                </td>
                <td>
                  <div className="flex items-start gap-2">
                    <p className="line-clamp-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                      {item.evidence}
                    </p>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost shrink-0"
                      aria-label={`View evidence for ${item.id}`}
                      onClick={() => setSelected(item)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      <span className="hidden lg:inline">View evidence</span>
                    </button>
                  </div>
                </td>
                <td>
                  <FixCell item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <div className="grid gap-3 md:hidden">
        {rows.map((item) => (
          <div key={item.id} className="card bg-base-100 shadow-sm">
            <div className="card-body gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <IdChip id={item.id} />
                <VerdictChip kind={item.verdict} />
                <FixStatusChip status={item.fix_status} />
              </div>
              <p className="text-sm leading-snug font-medium">{item.title}</p>
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {item.evidence}
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm w-fit"
                aria-label={`View evidence for ${item.id}`}
                onClick={() => setSelected(item)}
              >
                <Eye className="size-4" aria-hidden="true" />
                View evidence
              </button>
            </div>
          </div>
        ))}
      </div>

      <EvidenceDialog item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
