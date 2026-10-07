import { KeyRound, Laptop, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { routes } from "./routes";
export function SettingsNavigation() {
  return (
    <nav className="os-settings-tabs" aria-label="Settings">
      {[
        { label: "General", href: routes.settings, icon: SlidersHorizontal },
        { label: "Connections", href: routes.connections, icon: Laptop },
        { label: "Providers", href: routes.providers, icon: KeyRound },
        { label: "Security", href: routes.security, icon: ShieldCheck },
      ].map(({ label, href, icon: Icon }) => (
        <a
          href={href}
          key={href}
          aria-current={location.pathname === href ? "page" : undefined}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </a>
      ))}
    </nav>
  );
}
