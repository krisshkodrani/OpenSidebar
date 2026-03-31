import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

import Summarize from "./routes/summarize";
import Article from "./routes/article";
import Navigation from "./routes/navigation";
import Dashboard from "./routes/dashboard";
import Shop from "./routes/shop";
import Form from "./routes/form";
import Errors from "./routes/errors";
import DashboardSales from "./routes/dashboard-sales";
import DashboardSupport from "./routes/dashboard-support";
import DashboardMarketing from "./routes/dashboard-marketing";
import ScrollCatalog from "./routes/scroll-catalog";
import GoBackChain from "./routes/go-back-chain";
import DynamicCompute from "./routes/dynamic-compute";
import ProcurementList from "./routes/procurement-list";
import DelayedContent from "./routes/delayed-content";
import ModalOverlays from "./routes/modal-overlays";
import HoverMenus from "./routes/hover-menus";
import AutocompleteSearch from "./routes/autocomplete";
import DataTable from "./routes/data-table";
import Login from "./routes/login";
import Kanban from "./routes/kanban";
import FaqAccordion from "./routes/faq-accordion";
import FileUpload from "./routes/file-upload";
import ContextMenuPage from "./routes/context-menu";
import InfiniteScroll from "./routes/infinite-scroll";
import DatePickerPage from "./routes/date-picker";
import WebComponents from "./routes/web-components";
import KeyboardNav from "./routes/keyboard-nav";

const routes = [
  { path: "/summarize", label: "Summarize", title: "Transformer Architecture in Modern AI", component: Summarize },
  { path: "/article", label: "Article", title: "The Lost Expedition of 1924", component: Article },
  { path: "/navigation", label: "Navigation", title: "Navigation Challenge", component: Navigation },
  { path: "/dashboard", label: "Dashboard", title: "Admin Dashboard", component: Dashboard },
  { path: "/shop", label: "Shop", title: "Northstar Outfitters - Performance Running", component: Shop },
  { path: "/form", label: "Form", title: "Multi-Step Form", component: Form },
  { path: "/errors", label: "Errors", title: "Error Recovery Test", component: Errors },
  { path: "/dashboard-sales", label: "Sales", title: "Sales Dashboard", component: DashboardSales },
  { path: "/dashboard-support", label: "Support", title: "Support Dashboard", component: DashboardSupport },
  { path: "/dashboard-marketing", label: "Marketing", title: "Marketing Dashboard", component: DashboardMarketing },
  { path: "/scroll-catalog", label: "Scroll", title: "Office Equipment Catalog", component: ScrollCatalog },
  { path: "/go-back-chain", label: "GoBack", title: "Navigation Chain", component: GoBackChain },
  { path: "/dynamic-compute", label: "Compute", title: "Custom Product Configurator", component: DynamicCompute },
  { path: "/procurement", label: "Procurement", title: "Procurement List", component: ProcurementList },
  { path: "/delayed-content", label: "Delayed", title: "Delayed Content Test", component: DelayedContent },
  { path: "/modal-overlays", label: "Modals", title: "Modal & Overlay Test", component: ModalOverlays },
  { path: "/hover-menus", label: "Hover", title: "Hover Menus & Tooltips", component: HoverMenus },
  { path: "/autocomplete", label: "Autocomplete", title: "Autocomplete & Typeahead", component: AutocompleteSearch },
  { path: "/data-table", label: "Table", title: "Employee Directory", component: DataTable },
  { path: "/login", label: "Login", title: "Sign In", component: Login },
  { path: "/kanban", label: "Kanban", title: "Kanban Board", component: Kanban },
  { path: "/faq-accordion", label: "FAQ", title: "Frequently Asked Questions", component: FaqAccordion },
  { path: "/file-upload", label: "Upload", title: "Support Ticket", component: FileUpload },
  { path: "/context-menu", label: "CtxMenu", title: "Document Manager", component: ContextMenuPage },
  { path: "/infinite-scroll", label: "Feed", title: "Social Feed", component: InfiniteScroll },
  { path: "/date-picker", label: "DatePick", title: "Booking Form", component: DatePickerPage },
  { path: "/web-components", label: "WebComp", title: "Web Components", component: WebComponents },
  { path: "/keyboard-nav", label: "Keyboard", title: "Spreadsheet Editor", component: KeyboardNav },
];

function Layout({ children, currentPath }) {
  const navigate = (path) => {
    window.location.href = path;
  };

  return (
    <>
      <div className="fixture-nav">
        <div className="fixture-nav-inner">
          <span className="fixture-logo">OpenSidebar Fixtures</span>
          <div className="fixture-links">
            {routes.map((route) => (
              <a
                key={route.path}
                href={route.path}
                className={currentPath === route.path ? "active" : ""}
              >
                {route.label}
              </a>
            ))}
          </div>
        </div>
      </div>
      {children}
    </>
  );
}

function getLocationState() {
  const pathname = window.location.pathname || "/";
  const search = window.location.search || "";
  return {
    pathname,
    locationKey: `${pathname}${search}`,
  };
}

function App() {
  const [locationState, setLocationState] = useState(() => getLocationState());
  const currentPath = locationState.pathname;

  useEffect(() => {
    const syncLocationState = () => {
      const nextState = getLocationState();
      setLocationState(nextState);

      // Update document.title so chrome.tabs.get() returns the correct title.
      const route = routes.find((r) => r.path === nextState.pathname);
      if (route?.title) document.title = route.title;
    };

    syncLocationState();

    const handlePopstate = () => {
      syncLocationState();
    };

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  const RouteComponent =
    routes.find((r) => r.path === currentPath)?.component || Shop;

  return (
    <Layout currentPath={currentPath}>
      <RouteComponent key={locationState.locationKey} />
    </Layout>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

window.app = window.app || {};
window.app.getState = () => window.__shopState;
