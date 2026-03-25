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

function App() {
  const [currentPath, setCurrentPath] = useState("/shop");

  useEffect(() => {
    // Get current path from URL
    const path = window.location.pathname;
    const cleanPath = path || "/";
    setCurrentPath(cleanPath);

    // Update document.title so chrome.tabs.get() returns the correct title
    const route = routes.find((r) => r.path === cleanPath);
    if (route?.title) document.title = route.title;

    // Handle popstate for SPA navigation
    const handlePopstate = () => {
      const newPath = window.location.pathname || "/";
      setCurrentPath(newPath);
      const r = routes.find((rt) => rt.path === newPath);
      if (r?.title) document.title = r.title;
    };
    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  const RouteComponent =
    routes.find((r) => r.path === currentPath)?.component || Shop;

  return (
    <Layout currentPath={currentPath}>
      <RouteComponent />
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
