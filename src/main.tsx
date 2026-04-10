import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./AdminApp";
import DashboardApp from "./DashboardApp";
import "./styles.css";
import "./admin.css";
import "./dashboard.css";

const pathname = window.location.pathname;
let RootComponent = App;
if (pathname.startsWith("/admin")) {
  RootComponent = AdminApp;
} else if (pathname.startsWith("/dashboard")) {
  RootComponent = DashboardApp;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
