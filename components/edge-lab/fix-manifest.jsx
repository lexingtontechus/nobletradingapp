"use client";

import { ArrowRight } from "lucide-react";

import { FixStatusChip, IdChip } from "./chips";

export function FixManifest({ data }) {
  const fixes = data.fixes ?? [];
  const note = data.meta?.fix_manifest_note;

  return (
    <div className="grid gap-4">
      {fixes.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Weakness → Fix</th>
                <th>What shipped</th>
                <th>Files</th>
                <th>Test</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {fixes.map((fix) => (
                <tr key={fix.id}>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <IdChip id={fix.id} className="badge-error" />
                      <ArrowRight
                        className="size-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <FixStatusChip status={fix.status} />
                    </div>
                    <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      {fix.weakness}
                    </p>
                  </td>
                  <td className="max-w-md text-xs leading-relaxed">{fix.fix}</td>
                  <td>
                    <ul className="grid gap-0.5 font-mono text-[10px] leading-relaxed break-all text-muted-foreground">
                      {fix.files.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="font-mono text-xs whitespace-nowrap">{fix.test}</td>
                  <td>
                    <div className="grid gap-1">
                      <FixStatusChip status={fix.status} />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        mode: {fix.mode}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="alert alert-info">
          <div>
            <p className="font-medium">No fixes recorded in this run.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {note ||
                "The fixes array is empty for this artifact — the coordinator that records shipped fixes has not run against it."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
