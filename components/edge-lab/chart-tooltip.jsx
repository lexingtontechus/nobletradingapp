"use client";

import { fmtNum } from "@/lib/edge-lab-format";

/**
 * Shape of what recharts injects into custom tooltip `content` elements.
 */
export function ChartTooltip({ active, label, payload, format, labelFormat }) {
  if (!active || !payload || payload.length === 0) return null;

  const entries = payload.filter((entry) => {
    const v = Array.isArray(entry.value) ? entry.value[0] : entry.value;
    return v !== null && v !== undefined;
  });
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-card-foreground text-xs shadow-lg">
      {label !== undefined && label !== null ? (
        <div className="mb-1 font-mono text-[11px] text-muted-foreground">
          {typeof label === "string" && labelFormat
            ? labelFormat(label)
            : String(label)}
        </div>
      ) : null}
      <div className="grid gap-0.5">
        {entries.map((entry, i) => {
          const raw = Array.isArray(entry.value)
            ? entry.value[0]
            : entry.value;
          const num = typeof raw === "number" ? raw : Number(raw);
          return (
            <div
              key={`${String(entry.dataKey ?? entry.name ?? i)}`}
              className="flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden="true"
                />
                {String(entry.name ?? entry.dataKey ?? "")}
              </span>
              <span className="font-mono tabular-nums">
                {Number.isFinite(num)
                  ? format
                    ? format(num)
                    : fmtNum(num, 2)
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}