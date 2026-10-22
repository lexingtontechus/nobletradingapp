"use client";

/**
 * Consistent numbered section header used across the dashboard.
 * @param {Object} props
 * @param {string} props.index
 * @param {string} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ComponentType} props.icon
 * @param {React.ReactNode} props.children
 * @param {string} [props.id]
 */
export function SectionShell({ index, title, description, icon: Icon, children, id }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-5 flex items-start gap-3 md:mb-7 md:gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-base-300 bg-base-100 text-muted-foreground md:size-11">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
            {index}
          </div>
          <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}
