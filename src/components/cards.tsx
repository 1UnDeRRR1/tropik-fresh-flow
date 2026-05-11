import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  to,
  hash,
  pulse = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "brand" | "primary" | "danger" | "warning" | "success" | "info";
  to?: string;
  hash?: string;
  pulse?: boolean;
}) {
  const body = (
    <div
      className={cn(
        "h-full rounded-2xl border border-border bg-card p-4 shadow-card transition active:scale-[0.98]",
        tone === "brand" && "border-transparent bg-brand text-brand-foreground",
        tone === "primary" && "border-transparent bg-primary text-primary-foreground",
        tone === "danger" && "border-transparent bg-destructive text-destructive-foreground shadow-lg",
        tone === "warning" && "border-transparent bg-warning text-foreground shadow-lg",
        tone === "success" && "border-transparent bg-success text-foreground shadow-lg",
        tone === "info" && "border-transparent bg-info text-foreground shadow-lg",
        pulse && "animate-pulse",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-sm font-bold uppercase tracking-wide",
            tone === "default" ? "text-muted-foreground" : "opacity-90",
          )}
        >
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-normal tracking-tight">{value}</div>
      {hint && (
        <div className={cn("mt-1 text-xs", tone === "default" ? "text-muted-foreground" : "opacity-80")}>
          {hint}
        </div>
      )}
    </div>
  );
  return to ? <Link to={to} hash={hash}>{body}</Link> : body;
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
