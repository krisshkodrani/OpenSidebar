import { useEffect, type ReactNode } from "react";
import { ArrowLeft, Moon, PanelLeft, Sun } from "lucide-react";
import { useAppearance } from "./appearance";

export function AuthFrame({ children, title = "Sign in" }: { children: ReactNode; title?: string }) {
  const [appearance, toggleAppearance] = useAppearance();
  useEffect(() => {
    document.title = `${title} · OpenSidebar`;
  }, [title]);
  return (
    <div className="os-auth">
      <header className="os-auth-header">
        <a className="os-brand" href="/" aria-label="OpenSidebar home">
          <span className="os-brand-mark">
            <PanelLeft size={23} />
          </span>
          OpenSidebar
        </a>
        <div className="os-auth-actions">
          <a href="/">
            <ArrowLeft size={15} aria-hidden="true" />
            Back to website
          </a>
          <button
            className="os-icon-button"
            onClick={toggleAppearance}
            aria-label={`Use ${appearance === "light" ? "dark" : "light"} theme`}
          >
            {appearance === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </header>
      <main className="os-auth-main">
        <section className="os-auth-art" aria-label="Welcome to OpenSidebar">
          <div className="os-auth-art-copy">
            <p className="os-auth-kicker">A little less busywork.</p>
            <h2>
              More room for
              <br />
              what matters.
            </h2>
            <p>
              Your browser, with a helping hand.
              <br />
              Pick up where you left off.
            </p>
          </div>
          <svg
            className="os-auth-illustration"
            viewBox="0 0 600 390"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="auth-orbit"
                x1="50"
                y1="50"
                x2="520"
                y2="380"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#93C5FD" />
                <stop offset="1" stopColor="#D8E8FF" />
              </linearGradient>
            </defs>
            <ellipse
              cx="305"
              cy="206"
              rx="262"
              ry="155"
              stroke="#A8CCFF"
              strokeOpacity=".35"
              transform="rotate(-18 305 206)"
            />
            <ellipse
              cx="305"
              cy="206"
              rx="218"
              ry="128"
              stroke="#A8CCFF"
              strokeOpacity=".22"
              transform="rotate(24 305 206)"
            />
            <circle cx="73" cy="205" r="8" fill="#B9D6FF" />
            <circle cx="495" cy="88" r="5" fill="#B9D6FF" />
            <rect
              x="108"
              y="88"
              width="377"
              height="237"
              rx="19"
              fill="#102D67"
              fillOpacity=".3"
              transform="rotate(-5 108 88)"
            />
            <rect
              x="92"
              y="73"
              width="387"
              height="237"
              rx="18"
              fill="#F7FAFF"
            />
            <path d="M92 112H479" stroke="#DCE6F4" />
            <circle cx="113" cy="93" r="4" fill="#B5C8E3" />
            <circle cx="127" cy="93" r="4" fill="#B5C8E3" />
            <circle cx="141" cy="93" r="4" fill="#B5C8E3" />
            <rect
              x="165"
              y="86"
              width="238"
              height="14"
              rx="7"
              fill="#E6EDF8"
            />
            <rect
              x="114"
              y="135"
              width="154"
              height="12"
              rx="6"
              fill="#A4BBDD"
            />
            <rect
              x="114"
              y="158"
              width="123"
              height="7"
              rx="3.5"
              fill="#D7E2F2"
            />
            <rect
              x="114"
              y="187"
              width="190"
              height="98"
              rx="9"
              fill="#E8EFF9"
            />
            <path
              d="M132 262L166 230L192 241L227 210L282 227"
              stroke="#81A9E5"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="329"
              y="129"
              width="131"
              height="165"
              rx="11"
              fill="url(#auth-orbit)"
            />
            <rect
              x="345"
              y="146"
              width="31"
              height="31"
              rx="9"
              fill="#245BCE"
            />
            <path
              d="M354 155H368V169H354V155ZM359 155V169"
              stroke="white"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <rect
              x="345"
              y="192"
              width="92"
              height="7"
              rx="3.5"
              fill="#7498CD"
            />
            <rect
              x="345"
              y="207"
              width="70"
              height="7"
              rx="3.5"
              fill="#9DB8DD"
            />
            <rect
              x="345"
              y="240"
              width="98"
              height="34"
              rx="8"
              fill="#245BCE"
            />
            <path
              d="M380 257H408M402 251L408 257L402 263"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="51" y="273" width="173" height="58" rx="14" fill="white" />
            <circle cx="81" cy="302" r="15" fill="#EAF0FE" />
            <path
              d="M74 302L79 307L88 297"
              stroke="#245BCE"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="105"
              y="293"
              width="96"
              height="7"
              rx="3.5"
              fill="#94AFD6"
            />
            <rect x="105" y="307" width="65" height="6" rx="3" fill="#D7E2F2" />
            <path
              d="M485 246L504 293L512 274L532 267L485 246Z"
              fill="#D3E5FF"
              stroke="#245BCE"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d="M71 103V121M62 112H80M509 177V191M502 184H516"
              stroke="#CCE2FF"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <p className="os-auth-art-footer">
            Your workspace. Connected to your browser.
          </p>
        </section>
        <div className="os-auth-entry">{children}</div>
      </main>
      <footer className="os-auth-footer">
        <span>OpenSidebar</span>
        <a href="mailto:support@playscenario.ai">Need help? Contact support</a>
      </footer>
    </div>
  );
}
