import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  FlaskConical,
  History,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeft,
  SearchCode,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import { AccountMenu } from "./AccountMenu";
import { useAppearance } from "./appearance";
import { isSettingsRoute, pageTitle, routes } from "./routes";

const navigation = [
  { label: "Overview", href: routes.overview, icon: LayoutDashboard },
  { label: "Sessions", href: routes.sessions, icon: History },
  { label: "Playground", href: routes.playground, icon: FlaskConical },
  { label: "Run viewer", href: routes.viewer, icon: SearchCode },
];
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [appearance, toggleAppearance] = useAppearance();
  useEffect(() => {
    document.title = `${pageTitle()} · OpenSidebar`;
  }, []);
  return (
    <div className="os-shell">
      <a className="os-skip" href="#workspace-content">
        Skip to content
      </a>
      <aside
        className="os-sidebar"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="os-brand-row">
          <a className="os-brand" href={routes.overview}>
            <span className="os-brand-mark">
              <PanelLeft size={22} strokeWidth={1.8} />
            </span>
            <span>
              OpenSidebar<small>Your browser workspace</small>
            </span>
          </a>
          <button
            ref={menuButton}
            className="os-icon-button os-mobile-menu"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <div
          id="workspace-navigation"
          className={`os-sidebar-content ${menuOpen ? "is-open" : ""}`}
        >
          <nav aria-label="Workspace">
            <p className="os-nav-label">Workspace</p>
            {navigation.map(({ label, href, icon: Icon }) => (
              <a
                key={href}
                className="os-nav-link"
                href={href}
                aria-current={location.pathname === href ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </a>
            ))}
            <p className="os-nav-label os-nav-account">Account</p>
            <a
              className="os-nav-link"
              href={routes.settings}
              aria-current={isSettingsRoute() ? "page" : undefined}
            >
              <Settings2 size={18} aria-hidden="true" />
              Settings
            </a>
          </nav>
          <div className="os-sidebar-bottom">
            <a className="os-help-link" href="mailto:support@playscenario.ai">
              Get help
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <AccountMenu />
          </div>
        </div>
      </aside>
      <div className="os-workspace">
        <div className="os-topbar">
          <div className="os-breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{pageTitle()}</strong>
          </div>
          <div className="os-topbar-actions">
            <a href="/" className="os-site-link">
              Website
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <button
              className="os-icon-button"
              onClick={toggleAppearance}
              aria-label={`Use ${appearance === "light" ? "dark" : "light"} theme`}
              title={`Use ${appearance === "light" ? "dark" : "light"} theme`}
            >
              {appearance === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </div>
        <main id="workspace-content" className="os-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="os-footer">
          <span>OpenSidebar workspace</span>
          <a href="mailto:support@playscenario.ai">Support</a>
        </footer>
      </div>
    </div>
  );
}
