import type { ReactNode } from "react";
import { AlertCircle, ArrowRight, Inbox, Loader2 } from "lucide-react";
import { signInHref } from "./routes";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="os-page-header">
      <div>
        {eyebrow && <p className="os-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="os-page-actions">{actions}</div>}
    </header>
  );
}
export function LoadingSpinner() {
  return <Loader2 size={16} className="os-spin os-loading-spinner" aria-hidden="true" />;
}
export function LoadingState({ label = "Loading…", inline = false }: {
  label?: string; inline?: boolean;
}) {
  return <div className={`os-loading ${inline ? "os-loading-inline" : ""}`} role="status" aria-atomic="true">
    <LoadingSpinner /><span>{label}</span>
  </div>;
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Please try again in a moment.";
  const needsLogin = /sign in|unauthenticated/i.test(message);
  return (
    <section className="os-state os-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <h2>
        {needsLogin ? "Your session has ended" : "We couldn’t load this page"}
      </h2>
      <p>{message}</p>
      {needsLogin ? (
        <a className="os-button os-primary" href={signInHref()}>
          Sign in
        </a>
      ) : (
        retry && (
          <button className="os-button" onClick={retry}>
            Try again
          </button>
        )
      )}
    </section>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="os-state">
      <span className="os-empty-icon">
        <Inbox size={22} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  );
}
export function ActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="os-text-link" href={href}>
      {children}
      <ArrowRight size={15} aria-hidden="true" />
    </a>
  );
}
export function StateBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return <span className={`os-badge os-badge-${tone}`}>{children}</span>;
}
