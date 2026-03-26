import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./AdminApp";
import "./styles.css";
import "./admin.css";

const isAdminPage = window.location.pathname.startsWith("/admin");
const RootComponent = isAdminPage ? AdminApp : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
